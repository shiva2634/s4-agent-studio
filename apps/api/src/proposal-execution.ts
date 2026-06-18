import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashContent, validateProposalPath, type AuditWriter } from "./change-proposals.js";
import { runAvailableChecks, runProjectCheck, type CheckAction } from "./command-runner.js";
import { getCurrentTaskRound, summarizeTaskState, updateTaskRound } from "./task-workflow.js";
import { classifyProposalRole, detectProposalConflicts } from "./specialist-orchestration.js";
import { markScaffoldApplied, markScaffoldRecovered, markScaffoldRolledBack } from "./scaffold-engine.js";
import { assertProjectActiveForPolicy, assertTaskOwnedRollbackFiles } from "./security-policy.js";

const execFileAsync = promisify(execFile);

type ProposalRow = {
  id: string;
  taskId: string;
  projectId: string;
  filePath: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  originalContent: string | null;
  originalContentHash: string | null;
  proposedContent: string | null;
  status: string;
  createdAt: string;
  taskAssignmentId?: string | null;
  agentId?: string | null;
};

type TaskRow = { id: string; projectId: string; rootPath: string; status: string };
type GitCheckpoint = {
  available: boolean;
  branch: string | null;
  head: string | null;
  checkpointRef: string | null;
  dirty: boolean;
  warning: string | null;
};

function hasColumn(db: Database.Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function insertTaskExecution(db: Database.Database, values: {
  id: string;
  taskId: string;
  taskRoundId: string | null;
  projectId: string;
  status: string;
  gitCheckpointJson?: string | null;
  safetySummaryJson?: string | null;
  checkResultsJson?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  if (hasColumn(db, "task_executions", "task_round_id")) {
    db.prepare(`INSERT INTO task_executions (id,task_id,task_round_id,project_id,status,git_checkpoint_json,safety_summary_json,check_results_json,error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(values.id, values.taskId, values.taskRoundId, values.projectId, values.status, values.gitCheckpointJson ?? null, values.safetySummaryJson ?? null, values.checkResultsJson ?? null, values.error ?? null, values.createdAt, values.updatedAt);
    return;
  }
  db.prepare(`INSERT INTO task_executions (id,task_id,project_id,status,git_checkpoint_json,safety_summary_json,check_results_json,error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(values.id, values.taskId, values.projectId, values.status, values.gitCheckpointJson ?? null, values.safetySummaryJson ?? null, values.checkResultsJson ?? null, values.error ?? null, values.createdAt, values.updatedAt);
}

type TaskExecutionRow = {
  id: string;
  taskId?: string;
  taskRoundId?: string | null;
  status: string;
  gitCheckpointJson: string | null;
  safetySummaryJson: string | null;
  checkResultsJson: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseGitCheckpoint(value: string | null): GitCheckpoint | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as GitCheckpoint;
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function gitCheckpoint(rootPath: string, taskId: string) {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: rootPath, windowsHide: true });
    const branch = (await execFileAsync("git", ["branch", "--show-current"], { cwd: rootPath, windowsHide: true })).stdout.trim();
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootPath, windowsHide: true })).stdout.trim();
    const status = (await execFileAsync("git", ["status", "--porcelain"], { cwd: rootPath, windowsHide: true })).stdout.trim();
    const checkpointRef = `s4-checkpoint-${taskId.slice(0, 12)}`;
    await execFileAsync("git", ["branch", "-f", checkpointRef, head], { cwd: rootPath, windowsHide: true });
    return { available: true, branch, head, checkpointRef, dirty: Boolean(status), warning: status ? "Working tree has pre-existing changes; only approved task files will be written." : null };
  } catch {
    return { available: false, branch: null, head: null, checkpointRef: null, dirty: false, warning: "Git checkpoint unavailable." };
  }
}

function getTask(db: Database.Database, taskId: string) {
  return db.prepare(`SELECT t.id,t.project_id AS projectId,t.status,p.root_path AS rootPath
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(taskId) as TaskRow | undefined;
}

function getApprovedApproval(db: Database.Database, task: TaskRow, taskRoundId?: string | null) {
  const hasTaskRoundColumn = hasColumn(db, "approvals", "task_round_id");
  const hasRiskColumn = hasColumn(db, "approvals", "risk_level");
  const columns = `id,task_id AS taskId${hasTaskRoundColumn ? ",task_round_id AS taskRoundId" : ""},${hasRiskColumn ? "risk_level AS riskLevel," : "'low' AS riskLevel,"}decided_at AS decidedAt,created_at AS createdAt`;
  if (taskRoundId && hasTaskRoundColumn) {
    return db.prepare(`SELECT ${columns} FROM approvals WHERE task_id=? AND task_round_id=? AND status='APPROVED' ORDER BY decided_at DESC,created_at DESC LIMIT 1`).get(task.id, taskRoundId) as { id: string; taskId: string; taskRoundId?: string | null; riskLevel: string; decidedAt: string | null; createdAt: string } | undefined;
  }
  return db.prepare(`SELECT ${columns} FROM approvals WHERE task_id=? AND status='APPROVED' ORDER BY decided_at DESC,created_at DESC LIMIT 1`).get(task.id) as { id: string; taskId: string; taskRoundId?: string | null; riskLevel: string; decidedAt: string | null; createdAt: string } | undefined;
}

function getApprovedProposals(db: Database.Database, task: TaskRow, taskRoundId?: string | null) {
  const hasTaskRoundColumn = hasColumn(db, "change_proposals", "task_round_id");
  const ownershipColumns = `${hasColumn(db, "change_proposals", "agent_id") ? ",agent_id AS agentId" : ""}${hasColumn(db, "change_proposals", "task_assignment_id") ? ",task_assignment_id AS taskAssignmentId" : ""}`;
  if (taskRoundId && hasTaskRoundColumn) {
    return db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,project_id AS projectId,file_path AS filePath,operation,
    original_content AS originalContent,original_content_hash AS originalContentHash,proposed_content AS proposedContent,status,created_at AS createdAt${ownershipColumns}
    FROM change_proposals WHERE task_id=? AND task_round_id=? AND status='APPROVED' ORDER BY created_at`)
      .all(task.id, taskRoundId) as ProposalRow[];
  }
  return hasTaskRoundColumn
    ? db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,project_id AS projectId,file_path AS filePath,operation,
      original_content AS originalContent,original_content_hash AS originalContentHash,proposed_content AS proposedContent,status,created_at AS createdAt${ownershipColumns}
      FROM change_proposals WHERE task_id=? AND project_id=? AND status='APPROVED' ORDER BY created_at`)
      .all(task.id, task.projectId) as ProposalRow[]
    : db.prepare(`SELECT id,task_id AS taskId,project_id AS projectId,file_path AS filePath,operation,
      original_content AS originalContent,original_content_hash AS originalContentHash,proposed_content AS proposedContent,status,created_at AS createdAt${ownershipColumns}
      FROM change_proposals WHERE task_id=? AND project_id=? AND status='APPROVED' ORDER BY created_at`)
      .all(task.id, task.projectId) as ProposalRow[];
}

function isWeakeningTestProposal(proposal: ProposalRow) {
  const normalized = proposal.filePath.toLowerCase().replaceAll("\\", "/");
  const isTest = normalized.includes("__tests__") || normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes(".test.") || normalized.includes(".spec.");
  if (!isTest) return false;
  if (proposal.operation === "DELETE") return true;
  const proposed = proposal.proposedContent ?? "";
  return /\b(?:describe|it|test)\.skip\b/.test(proposed) || /\b(?:xit|xtest)\s*\(/.test(proposed) || /\.only\s*\(/.test(proposed) || /skip(?:ped)?\s+test/i.test(proposed) || /disable(?:d)?\s+test/i.test(proposed);
}

function assertApprovalCoversProposals(approval: { riskLevel: string; decidedAt: string | null; createdAt: string }, proposals: ProposalRow[]) {
  const approvalTime = approval.decidedAt ?? approval.createdAt;
  if (approvalTime && proposals.some((proposal) => proposal.createdAt > approvalTime)) {
    throw new Error("Fresh human approval is required for this proposal round");
  }
  const needsHighRisk = proposals.some((proposal) => classifyProposalRole(proposal.filePath, proposal.operation) === "DATABASE" || isWeakeningTestProposal(proposal));
  if (needsHighRisk && approval.riskLevel !== "high" && approval.riskLevel !== "critical") {
    throw new Error("High-risk human approval is required before applying database or test-weakening proposals");
  }
}

export async function applyTaskProposals(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  assertProjectActiveForPolicy(db, task.projectId, { action: "PROPOSAL_APPLY", taskId: task.id, now, audit });
  const currentRound = getCurrentTaskRound(db, taskId);
  const approval = getApprovedApproval(db, task, currentRound?.id ?? null);
  if (!approval) throw new Error("An approved task approval is required before applying proposals");
  const conflicts = detectProposalConflicts(db, task.id, currentRound?.id ?? null);
  if (conflicts.length) throw new Error(`Conflicting specialist proposals require review before apply: ${conflicts.map((conflict) => conflict.filePath).join(", ")}`);
  const proposals = getApprovedProposals(db, task, currentRound?.id ?? null);
  if (!proposals.length) throw new Error("No approved proposals to apply");
  assertApprovalCoversProposals(approval, proposals);
  if (proposals.some((proposal) => proposal.operation === "DELETE")) throw new Error("DELETE proposals are disabled");

  const staged = [];
  for (const proposal of proposals) {
    const target = validateProposalPath(task.rootPath, proposal.filePath);
    const currentContent = await readTextIfExists(target.absolutePath);
    const currentHash = currentContent === null ? null : hashContent(currentContent);
    if (currentHash !== proposal.originalContentHash) throw new Error(`File changed after proposal creation: ${proposal.filePath}`);
    if (!proposal.proposedContent || proposal.proposedContent.charCodeAt(0) === 0xfeff) throw new Error(`Invalid proposed content: ${proposal.filePath}`);
    staged.push({ proposal, target, beforeContent: currentContent, beforeHash: currentHash, afterContent: proposal.proposedContent, afterHash: hashContent(proposal.proposedContent) });
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-apply-"));
  try {
    for (const item of staged) {
      const stagedPath = path.join(tempRoot, item.target.relativePath);
      await fs.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.writeFile(stagedPath, item.afterContent, { encoding: "utf8" });
      validateProposalPath(tempRoot, item.target.relativePath);
    }
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const checkpoint = await gitCheckpoint(task.rootPath, task.id);
  const executionId = randomUUID();
  insertTaskExecution(db, {
    id: executionId,
    taskId: task.id,
    taskRoundId: currentRound?.id ?? null,
    projectId: task.projectId,
    status: "APPLYING",
    gitCheckpointJson: JSON.stringify(checkpoint),
    safetySummaryJson: JSON.stringify({ files: staged.map((item) => item.target.relativePath), warning: checkpoint.warning }),
    createdAt: now,
    updatedAt: now
  });
  if (currentRound?.id) {
    updateTaskRound(db, currentRound.id, { status: "RUNNING", recoveryAvailable: false, recoveryStatus: null, recoveryOutcome: null, now });
  }

  const backups = new Map<string, string | null>();
  try {
    for (const item of staged) backups.set(item.target.absolutePath, item.beforeContent);
    for (const item of staged) {
      await fs.mkdir(path.dirname(item.target.absolutePath), { recursive: true });
      await fs.writeFile(item.target.absolutePath, item.afterContent, { encoding: "utf8" });
    }
  } catch (error) {
    for (const [absolutePath, content] of backups) {
      if (content === null) await fs.rm(absolutePath, { force: true });
      else await fs.writeFile(absolutePath, content, { encoding: "utf8" });
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const checkResults = await runAvailableChecks(task.rootPath, ["TYPECHECK", "LINT", "TEST", "BUILD"], { db, projectId: task.projectId, taskId: task.id, now, audit });
  const checksOk = checkResults.every((result) => result.ok);
  const finalStatus = checksOk ? "COMPLETED" : "FAILED_VALIDATION";
  for (const item of staged) {
    db.prepare(`INSERT INTO applied_file_changes
      (id,task_id,project_id,proposal_id,file_path,operation,before_hash,after_hash,before_content,after_content,approval_id,git_checkpoint_json,result,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), task.id, task.projectId, item.proposal.id, item.target.relativePath, item.proposal.operation, item.beforeHash, item.afterHash, item.beforeContent, item.afterContent, approval.id, JSON.stringify(checkpoint), checksOk ? "APPLIED" : "APPLIED_FAILED_VALIDATION", now);
    db.prepare("UPDATE change_proposals SET status='APPLIED',updated_at=? WHERE id=?").run(now, item.proposal.id);
    audit("CHANGE_PROPOSAL_APPLIED", `${item.proposal.operation} applied to ${item.target.relativePath}`, { projectId: task.projectId, taskId: task.id, payload: { proposalId: item.proposal.id, path: item.target.relativePath, operation: item.proposal.operation, beforeHash: item.beforeHash, afterHash: item.afterHash, approvalId: approval.id, gitCheckpoint: checkpoint, result: checksOk ? "APPLIED" : "APPLIED_FAILED_VALIDATION" } });
  }
  db.prepare("UPDATE task_executions SET status=?,check_results_json=?,updated_at=? WHERE id=?").run(finalStatus, JSON.stringify(checkResults), now, executionId);
  db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(finalStatus, now, task.id);
  if (currentRound?.id) {
    updateTaskRound(db, currentRound.id, {
      status: finalStatus,
      checkResultsJson: JSON.stringify(checkResults),
      nextRequiredAction: finalStatus === "FAILED_VALIDATION" ? "REVIEW_CHECK_RESULTS" : "CONTINUE_CHAT",
      completedAt: now,
      recoveryAvailable: false,
      recoveryStatus: null,
      recoveryOutcome: finalStatus === "FAILED_VALIDATION" ? "CHECKS_FAILED" : "CHECKS_PASSED",
      now
    });
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  markScaffoldApplied(db, task.id, now, audit);
  return { status: finalStatus, applied: staged.length, gitCheckpoint: checkpoint, checkResults };
}

export async function runTaskChecks(db: Database.Database, taskId: string, now: string, action?: CheckAction) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  assertProjectActiveForPolicy(db, task.projectId, { action: "COMMAND", taskId: task.id, now });
  const currentRound = getCurrentTaskRound(db, taskId);
  const results = action ? [await runProjectCheck(task.rootPath, action, { db, projectId: task.projectId, taskId: task.id, now })] : await runAvailableChecks(task.rootPath, ["TYPECHECK", "LINT", "TEST", "BUILD"], { db, projectId: task.projectId, taskId: task.id, now });
  const ok = results.every((result) => result.ok);
  insertTaskExecution(db, {
    id: randomUUID(),
    taskId: task.id,
    taskRoundId: currentRound?.id ?? null,
    projectId: task.projectId,
    status: ok ? "CHECKS_PASSED" : "CHECKS_FAILED",
    checkResultsJson: JSON.stringify(results),
    createdAt: now,
    updatedAt: now
  });
  if (currentRound?.id) {
    updateTaskRound(db, currentRound.id, {
      status: ok ? "COMPLETED" : "FAILED_VALIDATION",
      checkResultsJson: JSON.stringify(results),
      nextRequiredAction: ok ? "CONTINUE_CHAT" : "REVIEW_CHECK_RESULTS",
      completedAt: now,
      recoveryAvailable: false,
      recoveryStatus: ok ? "CHECKS_PASSED" : "CHECKS_FAILED",
      recoveryOutcome: ok ? "CHECKS_PASSED" : "CHECKS_FAILED",
      now
    });
  }
  if (!ok) db.prepare("UPDATE tasks SET status='FAILED_VALIDATION',updated_at=? WHERE id=?").run(now, task.id);
  return { status: ok ? "CHECKS_PASSED" : "CHECKS_FAILED", checkResults: results };
}

export function getTaskExecution(db: Database.Database, taskId: string) {
  const executions = (hasColumn(db, "task_executions", "task_round_id")
    ? db.prepare("SELECT id,task_id AS taskId,task_round_id AS taskRoundId,status,git_checkpoint_json AS gitCheckpointJson,safety_summary_json AS safetySummaryJson,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC")
    : db.prepare("SELECT id,task_id AS taskId,status,git_checkpoint_json AS gitCheckpointJson,safety_summary_json AS safetySummaryJson,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC")).all(taskId) as TaskExecutionRow[];
  const normalizedExecutions = executions.map((execution) => {
    const gitCheckpoint = parseGitCheckpoint(execution.gitCheckpointJson);
    const rollbackAvailable = Boolean(gitCheckpoint?.available) && execution.status !== "ROLLED_BACK";
    return {
      ...execution,
      gitCheckpoint,
      rollbackAvailable,
      rollbackStatus: execution.status === "ROLLED_BACK" ? "ROLLED_BACK" : rollbackAvailable ? "AVAILABLE" : "UNAVAILABLE"
    };
  });
  const checkpointExecution = normalizedExecutions.find((execution) => Boolean(execution.gitCheckpoint)) ?? null;
  const latestExecution = normalizedExecutions[0] ?? null;
  const rollbackAvailable = Boolean(checkpointExecution?.rollbackAvailable) && latestExecution?.status !== "ROLLED_BACK";
  const rollbackStatus = latestExecution?.status === "ROLLED_BACK" ? "ROLLED_BACK" : rollbackAvailable ? "AVAILABLE" : "UNAVAILABLE";
  const currentCheckpointExecution = checkpointExecution
    ? { ...checkpointExecution, rollbackAvailable, rollbackStatus }
    : null;
  const taskState = summarizeTaskState(db, taskId);
  const recoveryRow = hasColumn(db, "task_rounds", "recovery_outcome")
    ? db.prepare("SELECT recovery_outcome AS recoveryOutcome FROM task_rounds WHERE task_id=? ORDER BY round_number DESC LIMIT 1").get(taskId) as { recoveryOutcome: string | null } | undefined
    : undefined;
  return {
    executions: normalizedExecutions,
    checkpointExecution: currentCheckpointExecution,
    latestExecution,
    rollbackAvailable,
    rollbackStatus,
    recoveryAvailable: taskState.recoveryAvailable,
    recoveryOutcome: latestExecution?.status === "APPLYING" ? "EXECUTION_INTERRUPTED" : recoveryRow?.recoveryOutcome ?? (latestExecution?.status === "ROLLED_BACK" ? "CHECKPOINT_RESTORED" : latestExecution?.status === "FAILED_VALIDATION" ? "CHECKS_FAILED" : null),
    appliedFiles: db.prepare("SELECT proposal_id AS proposalId,file_path AS filePath,operation,before_hash AS beforeHash,after_hash AS afterHash,result,created_at AS createdAt FROM applied_file_changes WHERE task_id=? ORDER BY created_at DESC").all(taskId)
  };
}

export async function rollbackTask(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  const currentRound = getCurrentTaskRound(db, taskId);
  const changes = db.prepare("SELECT proposal_id AS proposalId,file_path AS filePath,before_content AS beforeContent,after_hash AS afterHash FROM applied_file_changes WHERE task_id=? ORDER BY created_at DESC").all(task.id) as Array<{ proposalId: string; filePath: string; beforeContent: string | null; afterHash: string | null }>;
  if (!changes.length) throw new Error("No applied changes to roll back");
  assertTaskOwnedRollbackFiles(db, { taskId: task.id, projectId: task.projectId, filePaths: changes.map((change) => change.filePath), now, audit });
  for (const change of changes) {
    const target = validateProposalPath(task.rootPath, change.filePath);
    const currentContent = await readTextIfExists(target.absolutePath);
    const currentHash = currentContent === null ? null : hashContent(currentContent);
    if (currentHash !== change.afterHash) throw new Error(`Cannot roll back because file changed after apply: ${change.filePath}`);
  }
  for (const change of changes) {
    const target = validateProposalPath(task.rootPath, change.filePath);
    if (change.beforeContent === null) await fs.rm(target.absolutePath, { force: true });
    else await fs.writeFile(target.absolutePath, change.beforeContent, { encoding: "utf8" });
    audit("TASK_FILE_ROLLED_BACK", `Rolled back ${change.filePath}`, { projectId: task.projectId, taskId: task.id, payload: { proposalId: change.proposalId, path: change.filePath } });
  }
  db.prepare("UPDATE tasks SET status='ROLLED_BACK',updated_at=? WHERE id=?").run(now, task.id);
  insertTaskExecution(db, {
    id: randomUUID(),
    taskId: task.id,
    taskRoundId: currentRound?.id ?? null,
    projectId: task.projectId,
    status: "ROLLED_BACK",
    createdAt: now,
    updatedAt: now
  });
  if (currentRound?.id) {
    updateTaskRound(db, currentRound.id, {
      status: "ROLLED_BACK",
      nextRequiredAction: "CONTINUE_CHAT",
      completedAt: now,
      recoveryAvailable: false,
      recoveryStatus: "ROLLED_BACK",
      recoveryOutcome: "CHECKPOINT_RESTORED",
      now
    });
  }
  audit("TASK_ROLLED_BACK", "Task files rolled back", { projectId: task.projectId, taskId: task.id, payload: { fileCount: changes.length } });
  markScaffoldRolledBack(db, task.id, now, audit);
  return { status: "ROLLED_BACK", rolledBack: changes.length };
}

export async function recoverTaskExecution(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  assertProjectActiveForPolicy(db, task.projectId, { action: "RECOVERY", taskId: task.id, now, audit });
  const currentRound = getCurrentTaskRound(db, taskId);
  const latestExecution = (hasColumn(db, "task_executions", "task_round_id")
    ? db.prepare("SELECT id,task_id AS taskId,task_round_id AS taskRoundId,status,git_checkpoint_json AS gitCheckpointJson,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC LIMIT 1")
    : db.prepare("SELECT id,task_id AS taskId,status,git_checkpoint_json AS gitCheckpointJson,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC LIMIT 1")).get(taskId) as TaskExecutionRow | undefined;
  if (!latestExecution || latestExecution.status !== "APPLYING") throw new Error("No interrupted execution to recover");
  const approval = getApprovedApproval(db, task, currentRound?.id ?? null);
  const proposals = getApprovedProposals(db, task, currentRound?.id ?? null);
  if (!approval) throw new Error("An approved task approval is required before recovery");
  if (!proposals.length) throw new Error("No approved proposals to recover");

  for (const proposal of proposals) {
    const target = validateProposalPath(task.rootPath, proposal.filePath);
    const currentContent = await readTextIfExists(target.absolutePath);
    const currentHash = currentContent === null ? null : hashContent(currentContent);
    const expectedHash = proposal.proposedContent === null ? null : hashContent(proposal.proposedContent);
    if (currentHash !== expectedHash) throw new Error(`Cannot recover because file content no longer matches the applied proposal: ${proposal.filePath}`);
  }

  const checkResults = await runAvailableChecks(task.rootPath, ["TYPECHECK", "LINT", "TEST", "BUILD"], { db, projectId: task.projectId, taskId: task.id, now, audit });
  const checksOk = checkResults.every((result) => result.ok);
  const finalStatus = checksOk ? "COMPLETED" : "FAILED_VALIDATION";
  const gitCheckpoint = latestExecution.gitCheckpointJson ?? null;

  for (const proposal of proposals) {
    const existingChange = db.prepare("SELECT id FROM applied_file_changes WHERE task_id=? AND proposal_id=?").get(task.id, proposal.id) as { id: string } | undefined;
    if (existingChange) continue;
    db.prepare(`INSERT INTO applied_file_changes
      (id,task_id,project_id,proposal_id,file_path,operation,before_hash,after_hash,before_content,after_content,approval_id,git_checkpoint_json,result,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), task.id, task.projectId, proposal.id, proposal.filePath, proposal.operation, proposal.originalContentHash, proposal.proposedContent ? hashContent(proposal.proposedContent) : null, proposal.originalContent, proposal.proposedContent ?? "", approval.id, gitCheckpoint, checksOk ? "APPLIED" : "APPLIED_FAILED_VALIDATION", now);
    db.prepare("UPDATE change_proposals SET status='APPLIED',updated_at=? WHERE id=?").run(now, proposal.id);
  }

  db.prepare("UPDATE task_executions SET status=?,check_results_json=?,updated_at=? WHERE id=?").run(finalStatus, JSON.stringify(checkResults), now, latestExecution.id);
  db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(finalStatus, now, task.id);
  if (currentRound?.id) {
    updateTaskRound(db, currentRound.id, {
      status: finalStatus,
      checkResultsJson: JSON.stringify(checkResults),
      nextRequiredAction: finalStatus === "FAILED_VALIDATION" ? "REVIEW_CHECK_RESULTS" : "CONTINUE_CHAT",
      completedAt: now,
      recoveryAvailable: false,
      recoveryStatus: "RECOVERED",
      recoveryOutcome: checksOk ? "CHECKS_PASSED" : "CHECKS_FAILED",
      now
    });
  }
  audit("TASK_RECOVERED", `Task recovery ${checksOk ? "completed" : "requires review"}`, { projectId: task.projectId, taskId: task.id, payload: { status: finalStatus, checkCount: checkResults.length } });
  markScaffoldRecovered(db, task.id, now, audit);
  return { status: finalStatus, checkResults, recoveryOutcome: checksOk ? "CHECKS_PASSED" : "CHECKS_FAILED" };
}
