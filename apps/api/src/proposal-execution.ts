import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashContent, validateProposalPath, type AuditWriter } from "./change-proposals.js";
import { runAvailableChecks, runProjectCheck, type CheckAction } from "./command-runner.js";

const execFileAsync = promisify(execFile);

type ProposalRow = {
  id: string;
  taskId: string;
  projectId: string;
  filePath: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  originalContentHash: string | null;
  proposedContent: string | null;
  status: string;
};

type TaskRow = { id: string; projectId: string; rootPath: string; status: string };

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

function getApprovedApproval(db: Database.Database, task: TaskRow) {
  return db.prepare("SELECT id,task_id AS taskId FROM approvals WHERE task_id=? AND status='APPROVED' ORDER BY decided_at DESC,created_at DESC LIMIT 1").get(task.id) as { id: string; taskId: string } | undefined;
}

function getApprovedProposals(db: Database.Database, task: TaskRow) {
  return db.prepare(`SELECT id,task_id AS taskId,project_id AS projectId,file_path AS filePath,operation,
    original_content_hash AS originalContentHash,proposed_content AS proposedContent,status
    FROM change_proposals WHERE task_id=? AND project_id=? AND status='APPROVED' ORDER BY created_at`)
    .all(task.id, task.projectId) as ProposalRow[];
}

export async function applyTaskProposals(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  const approval = getApprovedApproval(db, task);
  if (!approval) throw new Error("An approved task approval is required before applying proposals");
  const proposals = getApprovedProposals(db, task);
  if (!proposals.length) throw new Error("No approved proposals to apply");
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
  db.prepare(`INSERT INTO task_executions (id,task_id,project_id,status,git_checkpoint_json,safety_summary_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(executionId, task.id, task.projectId, "APPLYING", JSON.stringify(checkpoint), JSON.stringify({ files: staged.map((item) => item.target.relativePath), warning: checkpoint.warning }), now, now);

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

  const checkResults = await runAvailableChecks(task.rootPath);
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
  await fs.rm(tempRoot, { recursive: true, force: true });
  return { status: finalStatus, applied: staged.length, gitCheckpoint: checkpoint, checkResults };
}

export async function runTaskChecks(db: Database.Database, taskId: string, now: string, action?: CheckAction) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  const results = action ? [await runProjectCheck(task.rootPath, action)] : await runAvailableChecks(task.rootPath);
  const ok = results.every((result) => result.ok);
  db.prepare(`INSERT INTO task_executions (id,task_id,project_id,status,check_results_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), task.id, task.projectId, ok ? "CHECKS_PASSED" : "CHECKS_FAILED", JSON.stringify(results), now, now);
  if (!ok) db.prepare("UPDATE tasks SET status='FAILED_VALIDATION',updated_at=? WHERE id=?").run(now, task.id);
  return { status: ok ? "CHECKS_PASSED" : "CHECKS_FAILED", checkResults: results };
}

export function getTaskExecution(db: Database.Database, taskId: string) {
  return {
    executions: db.prepare("SELECT id,status,git_checkpoint_json AS gitCheckpointJson,safety_summary_json AS safetySummaryJson,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC").all(taskId),
    appliedFiles: db.prepare("SELECT proposal_id AS proposalId,file_path AS filePath,operation,before_hash AS beforeHash,after_hash AS afterHash,result,created_at AS createdAt FROM applied_file_changes WHERE task_id=? ORDER BY created_at DESC").all(taskId)
  };
}

export async function rollbackTask(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = getTask(db, taskId);
  if (!task) throw new Error("Task not found");
  const changes = db.prepare("SELECT proposal_id AS proposalId,file_path AS filePath,before_content AS beforeContent,after_hash AS afterHash FROM applied_file_changes WHERE task_id=? ORDER BY created_at DESC").all(task.id) as Array<{ proposalId: string; filePath: string; beforeContent: string | null; afterHash: string | null }>;
  if (!changes.length) throw new Error("No applied changes to roll back");
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
  db.prepare(`INSERT INTO task_executions (id,task_id,project_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(randomUUID(), task.id, task.projectId, "ROLLED_BACK", now, now);
  audit("TASK_ROLLED_BACK", "Task files rolled back", { projectId: task.projectId, taskId: task.id, payload: { fileCount: changes.length } });
  return { status: "ROLLED_BACK", rolledBack: changes.length };
}
