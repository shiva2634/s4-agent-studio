import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { hashContent, validateProposalPath, type AuditWriter } from "./change-proposals.js";
import { runAvailableChecks } from "./command-runner.js";
import { detectProposalConflicts } from "./specialist-orchestration.js";
import { getCurrentTaskRound } from "./task-workflow.js";
import { assertProjectActiveForPolicy, sanitizeForPolicy } from "./security-policy.js";

const execFileAsync = promisify(execFile);

type GitMode = "DIRECT" | "BRANCH" | "WORKTREE";
type MergeStrategy = "fast-forward" | "no-ff" | "squash";

export class GitWorkflowError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message);
  }
}

type TaskProject = { taskId: string; title: string; projectId: string; projectName: string; rootPath: string; projectStatus: string };
type WorkflowRow = { id: string; taskId: string; projectId: string; mode: GitMode; status: string; baseBranch: string | null; baseCommit: string | null; branchName: string | null; worktreePath: string | null; lastError: string | null; createdAt: string; updatedAt: string; completedAt: string | null };
type ProposalRow = { id: string; filePath: string; operation: "CREATE" | "UPDATE" | "DELETE"; originalContentHash: string | null; proposedContent: string | null; status: string; createdAt: string };

async function git(rootPath: string, args: string[], input: { projectId?: string; taskId?: string; db?: Database.Database; now?: string; audit?: AuditWriter } = {}) {
  try {
    const result = await execFileAsync("git", args, { cwd: rootPath, windowsHide: true, maxBuffer: 200_000 });
    return sanitizeForPolicy(input.db ?? null, `${result.stdout}${result.stderr}`.trim(), { projectId: input.projectId, taskId: input.taskId, source: "git-output", now: input.now, audit: input.audit });
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    const output = sanitizeForPolicy(input.db ?? null, `${maybe.stdout ?? ""}${maybe.stderr ?? ""}${maybe.message ?? ""}`.trim(), { projectId: input.projectId, taskId: input.taskId, source: "git-error", now: input.now, audit: input.audit });
    throw new GitWorkflowError(output || `Git command failed: git ${args[0] ?? ""}`);
  }
}

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function taskProject(db: Database.Database, taskId: string) {
  const row = db.prepare(`SELECT t.id AS taskId,t.title,p.id AS projectId,p.name AS projectName,p.root_path AS rootPath,p.status AS projectStatus
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(taskId) as TaskProject | undefined;
  if (!row) throw new GitWorkflowError("Task not found", 404);
  return row;
}

function settings(db: Database.Database, projectId: string) {
  const row = db.prepare("SELECT default_branch AS defaultBranch,merge_strategy AS mergeStrategy,worktree_root_path AS worktreeRootPath,branch_mode_enabled AS branchModeEnabled,worktree_mode_enabled AS worktreeModeEnabled FROM project_git_settings WHERE project_id=?").get(projectId) as { defaultBranch: string; mergeStrategy: MergeStrategy; worktreeRootPath: string; branchModeEnabled: number; worktreeModeEnabled: number } | undefined;
  if (!row) throw new GitWorkflowError("Project Git settings are not configured", 500);
  return row;
}

function recordGitEvent(db: Database.Database, eventType: string, summary: string, values: { projectId?: string; taskId?: string; workflowId?: string; payload?: unknown; now: string; audit?: AuditWriter }) {
  const cleanSummary = sanitizeForPolicy(db, summary, { projectId: values.projectId, taskId: values.taskId, source: "git-event-summary", now: values.now, audit: values.audit });
  const cleanPayload = values.payload ? JSON.parse(sanitizeForPolicy(db, JSON.stringify(values.payload), { projectId: values.projectId, taskId: values.taskId, source: "git-event-payload", now: values.now, audit: values.audit })) : {};
  db.prepare("INSERT INTO git_workflow_events (id,project_id,task_id,task_git_workflow_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(), values.projectId ?? null, values.taskId ?? null, values.workflowId ?? null, eventType, cleanSummary, JSON.stringify(cleanPayload), values.now);
  values.audit?.(eventType, cleanSummary, { projectId: values.projectId, taskId: values.taskId, payload: cleanPayload });
}

export function sanitizeRemoteUrl(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/(https?:\/\/)([^/@:\s]+:)?[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/(ghp|github_pat|glpat|xox[baprs])-?[A-Za-z0-9_=-]{16,}/gi, "[redacted]");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";
}

export function safeTaskBranchName(taskId: string, title: string) {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const branch = `app-studio/task/${safeTaskId}-${slugify(title)}`;
  assertSafeBranchName(branch);
  return branch;
}

export function assertSafeBranchName(branchName: string) {
  if (!/^app-studio\/task\/[A-Za-z0-9_-]+-[a-z0-9][a-z0-9-]*$/.test(branchName)) throw new GitWorkflowError("Unsafe task branch name");
  if (branchName.includes("..") || /[\s~^:?*[\\;&|<>]/.test(branchName)) throw new GitWorkflowError("Unsafe task branch name");
}

function assertInside(rootPath: string, targetPath: string) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new GitWorkflowError("Worktree path must stay under the approved worktree root");
}

function safeWorktreeName(value: string) {
  if (!value.trim()) throw new GitWorkflowError("Worktree name is required");
  if (path.isAbsolute(value) || value.includes("..") || /[\\/:;&|<>\s]/.test(value)) throw new GitWorkflowError("Unsafe worktree name");
  const safeName = value.replace(/[^A-Za-z0-9._-]/g, "-");
  if (!safeName || safeName !== value) throw new GitWorkflowError("Unsafe worktree name");
  return safeName;
}

async function currentBranch(rootPath: string, input: { db?: Database.Database; projectId?: string; now?: string }) {
  return (await git(rootPath, ["branch", "--show-current"], input)).trim();
}

async function headCommit(rootPath: string, input: { db?: Database.Database; projectId?: string; taskId?: string; now?: string }) {
  return (await git(rootPath, ["rev-parse", "HEAD"], input)).trim();
}

async function porcelain(rootPath: string, input: { db?: Database.Database; projectId?: string; taskId?: string; now?: string }) {
  return await git(rootPath, ["status", "--porcelain"], input);
}

export async function getProjectGitStatus(db: Database.Database, projectId: string, now: string) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as { id: string; name: string; rootPath: string; status: string } | undefined;
  if (!project) throw new GitWorkflowError("Project not found", 404);
  assertProjectActiveForPolicy(db, projectId, { action: "GIT_WORKFLOW", now });
  try {
    await git(project.rootPath, ["rev-parse", "--is-inside-work-tree"], { db, projectId, now });
    const branch = await currentBranch(project.rootPath, { db, projectId, now });
    const head = await headCommit(project.rootPath, { db, projectId, now });
    const status = await porcelain(project.rootPath, { db, projectId, now });
    const untracked = status.split(/\r?\n/).filter((line) => line.startsWith("??")).map((line) => line.slice(3));
    let aheadBehind = { ahead: 0, behind: 0, available: false };
    try {
      const counts = (await git(project.rootPath, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], { db, projectId, now })).trim().split(/\s+/).map(Number);
      aheadBehind = { ahead: counts[0] ?? 0, behind: counts[1] ?? 0, available: true };
    } catch {
      aheadBehind = { ahead: 0, behind: 0, available: false };
    }
    let remoteUrl: string | null = null;
    try {
      remoteUrl = sanitizeRemoteUrl(await git(project.rootPath, ["config", "--get", "remote.origin.url"], { db, projectId, now }));
    } catch {
      remoteUrl = null;
    }
    const checkpoint = db.prepare("SELECT git_checkpoint_json AS gitCheckpointJson FROM task_executions WHERE project_id=? AND git_checkpoint_json IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(projectId) as { gitCheckpointJson: string } | undefined;
    return { isGit: true, currentBranch: branch, headCommit: head, dirty: Boolean(status), untrackedFiles: untracked, aheadBehind, remoteUrl, lastCheckpoint: safeJson(checkpoint?.gitCheckpointJson, null) };
  } catch (error) {
    return { isGit: false, currentBranch: null, headCommit: null, dirty: false, untrackedFiles: [], aheadBehind: { ahead: 0, behind: 0, available: false }, remoteUrl: null, lastCheckpoint: null, error: error instanceof Error ? error.message : "Git status unavailable" };
  }
}

function getWorkflow(db: Database.Database, taskId: string) {
  return db.prepare("SELECT id,task_id AS taskId,project_id AS projectId,mode,status,base_branch AS baseBranch,base_commit AS baseCommit,branch_name AS branchName,worktree_path AS worktreePath,last_error AS lastError,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt FROM task_git_workflows WHERE task_id=?").get(taskId) as WorkflowRow | undefined;
}

export function getTaskGitWorkflowStatus(db: Database.Database, taskId: string) {
  if (!hasTable(db, "task_git_workflows")) return null;
  const workflow = getWorkflow(db, taskId);
  if (!workflow) return null;
  const branch = db.prepare("SELECT branch_name AS branchName,base_branch AS baseBranch,base_commit AS baseCommit,head_commit AS headCommit,status FROM task_branches WHERE task_git_workflow_id=? ORDER BY created_at DESC LIMIT 1").get(workflow.id);
  const worktree = db.prepare("SELECT worktree_path AS worktreePath,status,cleaned_at AS cleanedAt FROM task_worktrees WHERE task_git_workflow_id=? ORDER BY created_at DESC LIMIT 1").get(workflow.id);
  const releaseCandidate = db.prepare("SELECT id,branch_name AS branchName,base_branch AS baseBranch,base_commit AS baseCommit,head_commit AS headCommit,diff_summary AS diffSummary,changed_files_json AS changedFilesJson,check_results_json AS checkResultsJson,merge_strategy AS mergeStrategy,approval_id AS approvalId,status,blocked_reason AS blockedReason FROM release_candidates WHERE task_git_workflow_id=? ORDER BY created_at DESC LIMIT 1").get(workflow.id) as any;
  const events = db.prepare("SELECT event_type AS eventType,summary,created_at AS createdAt FROM git_workflow_events WHERE task_git_workflow_id=? ORDER BY created_at DESC LIMIT 20").all(workflow.id);
  return {
    workflow,
    branch,
    worktree,
    releaseCandidate: releaseCandidate ? { ...releaseCandidate, changedFiles: safeJson(releaseCandidate.changedFilesJson, []), checkResults: safeJson(releaseCandidate.checkResultsJson, []) } : null,
    events
  };
}

export async function createTaskGitWorkflow(db: Database.Database, taskId: string, input: { mode: "BRANCH" | "WORKTREE"; now: string; audit: AuditWriter; worktreeName?: string }) {
  const task = taskProject(db, taskId);
  assertProjectActiveForPolicy(db, task.projectId, { action: "GIT_WORKFLOW", taskId, now: input.now, audit: input.audit });
  const existing = getWorkflow(db, taskId);
  if (existing) return getTaskGitWorkflowStatus(db, taskId);
  const projectSettings = settings(db, task.projectId);
  if (input.mode === "BRANCH" && !projectSettings.branchModeEnabled) throw new GitWorkflowError("Branch workflow is disabled for this project");
  if (input.mode === "WORKTREE" && !projectSettings.worktreeModeEnabled) throw new GitWorkflowError("Worktree workflow is disabled for this project");
  await git(task.rootPath, ["rev-parse", "--is-inside-work-tree"], { db, projectId: task.projectId, taskId, now: input.now, audit: input.audit });
  const baseBranch = await currentBranch(task.rootPath, { db, projectId: task.projectId, now: input.now });
  const baseCommit = await headCommit(task.rootPath, { db, projectId: task.projectId, taskId, now: input.now });
  const branchName = safeTaskBranchName(taskId, task.title);
  if (input.mode === "BRANCH" && await porcelain(task.rootPath, { db, projectId: task.projectId, taskId, now: input.now })) throw new GitWorkflowError("Dirty main branch blocks branch mode; use a governed worktree or clean the project first");
  try {
    await git(task.rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { db, projectId: task.projectId, taskId, now: input.now });
  } catch {
    await git(task.rootPath, ["branch", branchName, baseCommit], { db, projectId: task.projectId, taskId, now: input.now, audit: input.audit });
  }
  let worktreePath: string | null = null;
  if (input.mode === "WORKTREE") {
    const root = path.resolve(projectSettings.worktreeRootPath);
    const safeName = input.worktreeName ? safeWorktreeName(input.worktreeName) : `${taskId}-${slugify(task.title)}`;
    worktreePath = path.resolve(root, safeName);
    assertInside(root, worktreePath);
    await fs.mkdir(root, { recursive: true });
    await git(task.rootPath, ["worktree", "add", worktreePath, branchName], { db, projectId: task.projectId, taskId, now: input.now, audit: input.audit });
  } else {
    await git(task.rootPath, ["checkout", branchName], { db, projectId: task.projectId, taskId, now: input.now, audit: input.audit });
  }
  const workflowId = randomUUID();
  db.prepare("INSERT INTO task_git_workflows (id,task_id,project_id,mode,status,base_branch,base_commit,branch_name,worktree_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(workflowId, taskId, task.projectId, input.mode, input.mode === "WORKTREE" ? "WORKTREE_CREATED" : "BRANCH_CREATED", baseBranch, baseCommit, branchName, worktreePath, input.now, input.now);
  db.prepare("INSERT INTO task_branches (id,task_git_workflow_id,task_id,project_id,branch_name,base_branch,base_commit,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), workflowId, taskId, task.projectId, branchName, baseBranch, baseCommit, "ACTIVE", input.now, input.now);
  if (worktreePath) {
    db.prepare("INSERT INTO task_worktrees (id,task_git_workflow_id,task_id,project_id,branch_name,worktree_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), workflowId, taskId, task.projectId, branchName, worktreePath, "ACTIVE", input.now, input.now);
    recordGitEvent(db, "GIT_WORKTREE_CREATED", `Worktree created for ${branchName}`, { projectId: task.projectId, taskId, workflowId, now: input.now, audit: input.audit, payload: { worktreePath } });
  }
  recordGitEvent(db, "GIT_BRANCH_CREATED", `Task branch created: ${branchName}`, { projectId: task.projectId, taskId, workflowId, now: input.now, audit: input.audit, payload: { branchName, baseCommit } });
  return getTaskGitWorkflowStatus(db, taskId);
}

function targetPath(task: TaskProject, workflow: WorkflowRow) {
  return workflow.mode === "WORKTREE" && workflow.worktreePath ? workflow.worktreePath : task.rootPath;
}

function approvedApproval(db: Database.Database, taskId: string) {
  return db.prepare("SELECT id,decided_at AS decidedAt,created_at AS createdAt FROM approvals WHERE task_id=? AND status='APPROVED' ORDER BY decided_at DESC,created_at DESC LIMIT 1").get(taskId) as { id: string; decidedAt: string | null; createdAt: string } | undefined;
}

function approvedProposals(db: Database.Database, taskId: string) {
  return db.prepare("SELECT id,file_path AS filePath,operation,original_content_hash AS originalContentHash,proposed_content AS proposedContent,status,created_at AS createdAt FROM change_proposals WHERE task_id=? AND status='APPROVED' ORDER BY created_at").all(taskId) as ProposalRow[];
}

export async function applyApprovedProposalsToGitWorkflow(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow || workflow.mode === "DIRECT") throw new GitWorkflowError("Task Git workflow has not been created");
  assertProjectActiveForPolicy(db, task.projectId, { action: "GIT_WORKFLOW", taskId, now, audit });
  const approval = approvedApproval(db, taskId);
  if (!approval) throw new GitWorkflowError("Human approval is required before applying proposals to a task branch");
  const conflicts = detectProposalConflicts(db, taskId, getCurrentTaskRound(db, taskId)?.id ?? null);
  if (conflicts.length) throw new GitWorkflowError("Unresolved proposal conflicts block branch apply");
  const proposals = approvedProposals(db, taskId);
  if (!proposals.length) throw new GitWorkflowError("No approved proposals to apply");
  const root = targetPath(task, workflow);
  db.prepare("UPDATE task_git_workflows SET status='APPLYING',updated_at=? WHERE id=?").run(now, workflow.id);
  for (const proposal of proposals) {
    if (proposal.operation === "DELETE") throw new GitWorkflowError("DELETE proposals are disabled");
    const target = validateProposalPath(root, proposal.filePath);
    let current: string | null = null;
    try { current = await fs.readFile(target.absolutePath, "utf8"); } catch { current = null; }
    const currentHash = current === null ? null : hashContent(current);
    if (currentHash !== proposal.originalContentHash) throw new GitWorkflowError(`File changed after proposal creation: ${proposal.filePath}`);
    await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
    await fs.writeFile(target.absolutePath, proposal.proposedContent ?? "", "utf8");
    db.prepare("UPDATE change_proposals SET status='APPLIED',updated_at=? WHERE id=?").run(now, proposal.id);
  }
  await git(root, ["add", "--", ...proposals.map((proposal) => proposal.filePath)], { db, projectId: task.projectId, taskId, now, audit });
  const staged = await git(root, ["diff", "--cached", "--name-only"], { db, projectId: task.projectId, taskId, now, audit });
  if (staged) {
    await git(root, ["-c", "user.name=App Studio", "-c", "user.email=app-studio@example.invalid", "commit", "-m", `App Studio task ${taskId}`], { db, projectId: task.projectId, taskId, now, audit });
  }
  const head = await headCommit(root, { db, projectId: task.projectId, taskId, now });
  db.prepare("UPDATE task_branches SET head_commit=?,status='APPLIED',updated_at=? WHERE task_git_workflow_id=?").run(head, now, workflow.id);
  db.prepare("UPDATE task_git_workflows SET status='APPLIED',updated_at=? WHERE id=?").run(now, workflow.id);
  recordGitEvent(db, "GIT_PROPOSALS_APPLIED_TO_BRANCH", `Approved proposals applied to ${workflow.branchName}`, { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit, payload: { proposalCount: proposals.length, headCommit: head } });
  return getTaskGitWorkflowStatus(db, taskId);
}

export async function runGitWorkflowChecks(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow) throw new GitWorkflowError("Task Git workflow has not been created");
  const root = targetPath(task, workflow);
  db.prepare("UPDATE task_git_workflows SET status='CHECKING',updated_at=? WHERE id=?").run(now, workflow.id);
  const results = await runAvailableChecks(root, ["TYPECHECK", "LINT", "TEST", "BUILD"], { db, projectId: task.projectId, taskId, now, audit });
  const ok = results.every((result) => result.ok);
  db.prepare("INSERT INTO task_executions (id,task_id,project_id,status,check_results_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), taskId, task.projectId, ok ? "CHECKS_PASSED" : "CHECKS_FAILED", JSON.stringify(results), now, now);
  db.prepare("UPDATE task_git_workflows SET status=?,updated_at=?,last_error=? WHERE id=?").run(ok ? "CHECKS_PASSED" : "CHECKS_FAILED", now, ok ? null : "Checks failed", workflow.id);
  recordGitEvent(db, ok ? "GIT_CHECKS_PASSED" : "GIT_CHECKS_FAILED", ok ? "Git workflow checks passed" : "Git workflow checks failed", { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit, payload: { results } });
  return { status: ok ? "CHECKS_PASSED" : "CHECKS_FAILED", checkResults: results };
}

export async function createReleaseCandidate(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow?.branchName || !workflow.baseCommit || !workflow.baseBranch) throw new GitWorkflowError("Task Git workflow has not been created");
  if (workflow.status !== "CHECKS_PASSED") throw new GitWorkflowError("Release candidate requires passing checks");
  const root = targetPath(task, workflow);
  const head = await headCommit(root, { db, projectId: task.projectId, taskId, now });
  const changedFiles = (await git(root, ["diff", "--name-only", `${workflow.baseCommit}..${head}`], { db, projectId: task.projectId, taskId, now, audit })).split(/\r?\n/).filter(Boolean);
  const diffSummary = await git(root, ["diff", "--stat", `${workflow.baseCommit}..${head}`], { db, projectId: task.projectId, taskId, now, audit });
  const checks = db.prepare("SELECT check_results_json AS checkResultsJson FROM task_executions WHERE task_id=? AND status='CHECKS_PASSED' ORDER BY created_at DESC LIMIT 1").get(taskId) as { checkResultsJson: string } | undefined;
  const mergeStrategy = settings(db, task.projectId).mergeStrategy;
  const id = randomUUID();
  db.prepare(`INSERT INTO release_candidates (id,task_git_workflow_id,task_id,project_id,branch_name,base_branch,base_commit,head_commit,diff_summary,changed_files_json,check_results_json,merge_strategy,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, workflow.id, taskId, task.projectId, workflow.branchName, workflow.baseBranch, workflow.baseCommit, head, diffSummary, JSON.stringify(changedFiles), checks?.checkResultsJson ?? "[]", mergeStrategy, "CREATED", now, now);
  db.prepare("UPDATE task_git_workflows SET status='RELEASE_CANDIDATE_CREATED',updated_at=? WHERE id=?").run(now, workflow.id);
  recordGitEvent(db, "GIT_RELEASE_CANDIDATE_CREATED", `Release candidate created for ${workflow.branchName}`, { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit, payload: { releaseCandidateId: id, headCommit: head, changedFiles } });
  return getTaskGitWorkflowStatus(db, taskId);
}

export function requestMergeApproval(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  const rc = db.prepare("SELECT id,branch_name AS branchName,status FROM release_candidates WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string; branchName: string; status: string } | undefined;
  if (!workflow || !rc) throw new GitWorkflowError("Release candidate not found");
  const approvalId = nanoid();
  db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(approvalId, taskId, "GIT_MERGE", `Approve merge for ${rc.branchName}`, JSON.stringify({ releaseCandidateId: rc.id, branchName: rc.branchName }), "high", "PENDING", now);
  db.prepare("UPDATE release_candidates SET approval_id=?,status='AWAITING_MERGE_APPROVAL',updated_at=? WHERE id=?").run(approvalId, now, rc.id);
  db.prepare("UPDATE task_git_workflows SET status='AWAITING_MERGE_APPROVAL',updated_at=? WHERE id=?").run(now, workflow.id);
  recordGitEvent(db, "GIT_MERGE_APPROVAL_REQUESTED", `Merge approval requested for ${rc.branchName}`, { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit, payload: { approvalId, releaseCandidateId: rc.id } });
  return { approvalId, releaseCandidateId: rc.id };
}

export async function mergeApprovedReleaseCandidate(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  const rc = db.prepare("SELECT id,approval_id AS approvalId,branch_name AS branchName,base_branch AS baseBranch,base_commit AS baseCommit,head_commit AS headCommit,merge_strategy AS mergeStrategy,status FROM release_candidates WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string; approvalId: string | null; branchName: string; baseBranch: string; baseCommit: string; headCommit: string; mergeStrategy: MergeStrategy; status: string } | undefined;
  if (!workflow || !rc) throw new GitWorkflowError("Release candidate not found");
  const approval = rc.approvalId ? db.prepare("SELECT status FROM approvals WHERE id=?").get(rc.approvalId) as { status: string } | undefined : null;
  if (approval?.status !== "APPROVED") throw new GitWorkflowError("Merge requires human approval");
  if (workflow.status !== "AWAITING_MERGE_APPROVAL" && workflow.status !== "RELEASE_CANDIDATE_CREATED") throw new GitWorkflowError("Release candidate is not ready to merge");
  if (detectProposalConflicts(db, taskId, getCurrentTaskRound(db, taskId)?.id ?? null).length) throw new GitWorkflowError("Unresolved proposal conflicts block merge");
  const check = db.prepare("SELECT status FROM task_executions WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { status: string } | undefined;
  if (check?.status !== "CHECKS_PASSED") throw new GitWorkflowError("Checks must pass before merge");
  if (await porcelain(task.rootPath, { db, projectId: task.projectId, taskId, now })) throw new GitWorkflowError("Dirty main/default branch blocks merge");
  const currentBase = (await git(task.rootPath, ["rev-parse", rc.baseBranch], { db, projectId: task.projectId, taskId, now, audit })).trim();
  if (currentBase !== rc.baseCommit) throw new GitWorkflowError("Main/default branch changed since release candidate creation");
  db.prepare("UPDATE task_git_workflows SET status='MERGING',updated_at=? WHERE id=?").run(now, workflow.id);
  await git(task.rootPath, ["checkout", rc.baseBranch], { db, projectId: task.projectId, taskId, now, audit });
  const args = rc.mergeStrategy === "fast-forward"
    ? ["merge", "--ff-only", rc.branchName]
    : rc.mergeStrategy === "squash"
      ? ["merge", "--squash", rc.branchName]
      : ["merge", "--no-ff", rc.branchName, "-m", `Merge App Studio task ${taskId}`];
  await git(task.rootPath, rc.mergeStrategy === "squash" ? args : ["-c", "user.name=App Studio", "-c", "user.email=app-studio@example.invalid", ...args], { db, projectId: task.projectId, taskId, now, audit });
  if (rc.mergeStrategy === "squash") {
    await git(task.rootPath, ["-c", "user.name=App Studio", "-c", "user.email=app-studio@example.invalid", "commit", "-m", `Squash merge App Studio task ${taskId}`], { db, projectId: task.projectId, taskId, now, audit });
  }
  const mergedHead = await headCommit(task.rootPath, { db, projectId: task.projectId, taskId, now });
  db.prepare("UPDATE release_candidates SET status='MERGED',completed_at=?,updated_at=? WHERE id=?").run(now, now, rc.id);
  db.prepare("UPDATE task_git_workflows SET status='MERGED',completed_at=?,updated_at=? WHERE id=?").run(now, now, workflow.id);
  recordGitEvent(db, "GIT_MERGE_COMPLETED", `Release candidate merged: ${rc.branchName}`, { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit, payload: { releaseCandidateId: rc.id, mergedHead } });
  return getTaskGitWorkflowStatus(db, taskId);
}

export async function rollbackGitWorkflow(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow?.branchName || !workflow.baseCommit) throw new GitWorkflowError("Task Git workflow has not been created");
  const root = targetPath(task, workflow);
  if (workflow.mode === "BRANCH") await git(root, ["reset", "--hard", workflow.baseCommit], { db, projectId: task.projectId, taskId, now, audit });
  else await git(root, ["reset", "--hard", workflow.baseCommit], { db, projectId: task.projectId, taskId, now, audit });
  db.prepare("UPDATE task_git_workflows SET status='ROLLED_BACK',updated_at=? WHERE id=?").run(now, workflow.id);
  db.prepare("UPDATE task_branches SET status='ROLLED_BACK',updated_at=? WHERE task_git_workflow_id=?").run(now, workflow.id);
  recordGitEvent(db, "GIT_BRANCH_ROLLBACK", `Task branch rolled back: ${workflow.branchName}`, { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit });
  return getTaskGitWorkflowStatus(db, taskId);
}

export async function cleanupTaskWorktree(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow?.worktreePath) throw new GitWorkflowError("No App Studio worktree is recorded for this task");
  const projectSettings = settings(db, task.projectId);
  assertInside(projectSettings.worktreeRootPath, workflow.worktreePath);
  const record = db.prepare("SELECT status FROM task_worktrees WHERE task_git_workflow_id=? AND worktree_path=?").get(workflow.id, workflow.worktreePath) as { status: string } | undefined;
  if (!record) throw new GitWorkflowError("Worktree cleanup is allowed only for recorded App Studio worktrees");
  if (await porcelain(workflow.worktreePath, { db, projectId: task.projectId, taskId, now })) throw new GitWorkflowError("Worktree has uncommitted changes and cannot be cleaned up");
  await git(task.rootPath, ["worktree", "remove", workflow.worktreePath], { db, projectId: task.projectId, taskId, now, audit });
  db.prepare("UPDATE task_worktrees SET status='CLEANED',cleaned_at=?,updated_at=? WHERE task_git_workflow_id=?").run(now, now, workflow.id);
  db.prepare("UPDATE task_git_workflows SET status='WORKTREE_CLEANED',updated_at=? WHERE id=?").run(now, workflow.id);
  recordGitEvent(db, "GIT_WORKTREE_CLEANUP", "Recorded App Studio worktree cleaned up", { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit });
  return getTaskGitWorkflowStatus(db, taskId);
}

export async function recoverGitWorkflow(db: Database.Database, taskId: string, now: string, audit: AuditWriter) {
  const task = taskProject(db, taskId);
  const workflow = getWorkflow(db, taskId);
  if (!workflow) throw new GitWorkflowError("Task Git workflow has not been created");
  if (workflow.status === "APPLYING") {
    const root = targetPath(task, workflow);
    if (await porcelain(root, { db, projectId: task.projectId, taskId, now })) db.prepare("UPDATE task_git_workflows SET status='APPLIED',updated_at=? WHERE id=?").run(now, workflow.id);
  } else if (workflow.status === "CHECKING") {
    await runGitWorkflowChecks(db, taskId, now, audit);
  } else if (workflow.status === "MERGING") {
    const rc = db.prepare("SELECT head_commit AS headCommit FROM release_candidates WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { headCommit: string } | undefined;
    if (rc) {
      try {
        await git(task.rootPath, ["merge-base", "--is-ancestor", rc.headCommit, "HEAD"], { db, projectId: task.projectId, taskId, now, audit });
        db.prepare("UPDATE task_git_workflows SET status='MERGED',updated_at=? WHERE id=?").run(now, workflow.id);
      } catch {
        db.prepare("UPDATE task_git_workflows SET status='AWAITING_MERGE_APPROVAL',last_error='Merge recovery requires review',updated_at=? WHERE id=?").run(now, workflow.id);
      }
    }
  } else if (workflow.status === "CLEANUP") {
    await cleanupTaskWorktree(db, taskId, now, audit);
  }
  recordGitEvent(db, "GIT_WORKFLOW_RECOVERY", "Git workflow recovery completed", { projectId: task.projectId, taskId, workflowId: workflow.id, now, audit });
  return getTaskGitWorkflowStatus(db, taskId);
}
