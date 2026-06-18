import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, describe, it } from "node:test";
import { initializeDatabaseOn } from "@s4/db";
import { insertProposal } from "./change-proposals.js";
import { applyApprovedProposalsToGitWorkflow, assertSafeBranchName, cleanupTaskWorktree, createReleaseCandidate, createTaskGitWorkflow, getProjectGitStatus, mergeApprovedReleaseCandidate, recoverGitWorkflow, requestMergeApproval, rollbackGitWorkflow, runGitWorkflowChecks, safeTaskBranchName } from "./git-workflow.js";
import { registerOrReactivateProject } from "./project-registration.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const now = "2026-06-18T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const audit = () => undefined;

async function git(root: string, args: string[]) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function repoFixture(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `s4-git-${label}-`));
  const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), `s4-worktrees-${label}-`));
  roots.push(root, worktreeRoot);
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "console.log('ok');\n");
  await fs.writeFile(path.join(root, "scripts", "fail.cjs"), "process.exit(1);\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node scripts/pass.cjs", lint: "node scripts/pass.cjs", test: "node scripts/pass.cjs", build: "node scripts/pass.cjs" } }));
  await fs.writeFile(path.join(root, "existing.ts"), "export const value = 'before';\n");
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "s4@example.test"]);
  await git(root, ["config", "user.name", "S4"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  return { root, worktreeRoot };
}

function dbFixture(root: string, worktreeRoot: string, taskId = "task-1") {
  const db = new Database(":memory:");
  initializeDatabaseOn(db);
  registerOrReactivateProject(db, { id: "project-1", name: "Project", rootPath: root, now }, audit);
  db.prepare("UPDATE project_git_settings SET worktree_root_path=? WHERE project_id='project-1'").run(worktreeRoot);
  db.prepare("INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(taskId, "project-1", null, "developer", "Build Git workflow", "Build Git workflow", "AWAITING_APPROVAL", "low", "{}", now, now);
  db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(`approval-${taskId}`, taskId, "CHANGE_PROPOSAL", "Approve proposals", "{}", "low", "APPROVED", "2026-06-18T01:00:00.000Z", now);
  return db;
}

async function addApprovedProposal(db: Database.Database, root: string, taskId: string, filePath = "created.ts") {
  const proposal = await insertProposal(db, {
    id: `proposal-${randomUUID()}`,
    taskId,
    projectId: "project-1",
    rootPath: root,
    filePath,
    operation: "CREATE",
    proposedContent: `export const created = "${taskId}";\n`,
    reason: "Create task file",
    now
  });
  db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id=?").run(proposal.id);
  return proposal;
}

async function readyReleaseCandidate(db: Database.Database, root: string, taskId: string) {
  await addApprovedProposal(db, root, taskId);
  await createTaskGitWorkflow(db, taskId, { mode: "WORKTREE", now, audit });
  await applyApprovedProposalsToGitWorkflow(db, taskId, "2026-06-18T02:00:00.000Z", audit);
  await runGitWorkflowChecks(db, taskId, "2026-06-18T03:00:00.000Z", audit);
  await createReleaseCandidate(db, taskId, "2026-06-18T04:00:00.000Z", audit);
}

describe("governed Git branch and worktree workflows", () => {
  it("detects Git status and redacts remote URLs", async () => {
    const { root, worktreeRoot } = await repoFixture("status");
    const db = dbFixture(root, worktreeRoot);
    try {
      await git(root, ["remote", "add", "origin", "https://ghp_secretToken0000000000000000@github.com/example/repo.git"]);
      const status = await getProjectGitStatus(db, "project-1", now);
      assert.equal(status.isGit, true);
      assert.equal(status.remoteUrl?.includes("ghp_secretToken"), false);
      assert.equal(status.currentBranch !== null, true);
    } finally {
      db.close();
    }
  });

  it("creates deterministic safe task branch names and rejects unsafe names", () => {
    assert.equal(safeTaskBranchName("task-1", "Build Git Workflow!"), "app-studio/task/task-1-build-git-workflow");
    assert.throws(() => assertSafeBranchName("app-studio/task/../bad"), /Unsafe task branch name/);
    assert.throws(() => assertSafeBranchName("app-studio/task/task-1-bad;rm"), /Unsafe task branch name/);
  });

  it("creates worktrees only under the approved worktree root", async () => {
    const { root, worktreeRoot } = await repoFixture("worktree-root");
    const db = dbFixture(root, worktreeRoot);
    try {
      const workflow = await createTaskGitWorkflow(db, "task-1", { mode: "WORKTREE", worktreeName: "safe-worktree", now, audit });
      assert.ok(workflow?.workflow.worktreePath?.startsWith(path.resolve(worktreeRoot) + path.sep));
    } finally {
      db.close();
    }

    const other = await repoFixture("worktree-traversal");
    const traversalDb = dbFixture(other.root, other.worktreeRoot);
    try {
      await assert.rejects(() => createTaskGitWorkflow(traversalDb, "task-1", { mode: "WORKTREE", worktreeName: "../outside", now, audit }), /Unsafe worktree name/);
    } finally {
      traversalDb.close();
    }
  });

  it("applies proposals to worktrees only after human approval and preserves main changes", async () => {
    const { root, worktreeRoot } = await repoFixture("apply");
    const db = dbFixture(root, worktreeRoot);
    try {
      await addApprovedProposal(db, root, "task-1");
      db.prepare("UPDATE approvals SET status='PENDING',decided_at=NULL WHERE task_id='task-1'").run();
      await createTaskGitWorkflow(db, "task-1", { mode: "WORKTREE", now, audit });
      await assert.rejects(() => applyApprovedProposalsToGitWorkflow(db, "task-1", now, audit), /Human approval/);
      db.prepare("UPDATE approvals SET status='APPROVED',decided_at=? WHERE task_id='task-1'").run(now);
      await fs.writeFile(path.join(root, "manual.txt"), "keep\n");
      await applyApprovedProposalsToGitWorkflow(db, "task-1", "2026-06-18T02:00:00.000Z", audit);
      const workflow = db.prepare("SELECT worktree_path AS worktreePath FROM task_git_workflows WHERE task_id='task-1'").get() as { worktreePath: string };
      assert.match(await fs.readFile(path.join(workflow.worktreePath, "created.ts"), "utf8"), /created/);
      await assert.rejects(() => fs.readFile(path.join(root, "created.ts"), "utf8"));
      assert.equal(await fs.readFile(path.join(root, "manual.txt"), "utf8"), "keep\n");
    } finally {
      db.close();
    }
  });

  it("blocks release and merge gates for failed checks, conflicts, missing approval, and moved base branch", async () => {
    const { root, worktreeRoot } = await repoFixture("gates");
    const db = dbFixture(root, worktreeRoot);
    try {
      await addApprovedProposal(db, root, "task-1");
      await createTaskGitWorkflow(db, "task-1", { mode: "WORKTREE", now, audit });
      await applyApprovedProposalsToGitWorkflow(db, "task-1", "2026-06-18T02:00:00.000Z", audit);
      const workflow = db.prepare("SELECT worktree_path AS worktreePath FROM task_git_workflows WHERE task_id='task-1'").get() as { worktreePath: string };
      const pkg = JSON.parse(await fs.readFile(path.join(workflow.worktreePath, "package.json"), "utf8")) as { scripts: Record<string, string> };
      pkg.scripts.test = "node scripts/fail.cjs";
      await fs.writeFile(path.join(workflow.worktreePath, "package.json"), JSON.stringify(pkg));
      const failed = await runGitWorkflowChecks(db, "task-1", "2026-06-18T03:00:00.000Z", audit);
      assert.equal(failed.status, "CHECKS_FAILED");
      await assert.rejects(() => createReleaseCandidate(db, "task-1", "2026-06-18T04:00:00.000Z", audit), /passing checks/);
    } finally {
      db.close();
    }

    const other = await repoFixture("merge-gates");
    const mergeDb = dbFixture(other.root, other.worktreeRoot);
    try {
      await readyReleaseCandidate(mergeDb, other.root, "task-1");
      await assert.rejects(() => mergeApprovedReleaseCandidate(mergeDb, "task-1", "2026-06-18T05:00:00.000Z", audit), /human approval/i);
      requestMergeApproval(mergeDb, "task-1", "2026-06-18T05:00:00.000Z", audit);
      mergeDb.prepare("UPDATE approvals SET status='APPROVED',decided_at=? WHERE action_type='GIT_MERGE'").run("2026-06-18T05:30:00.000Z");
      await fs.writeFile(path.join(other.root, "base-change.txt"), "changed\n");
      await git(other.root, ["add", "base-change.txt"]);
      await git(other.root, ["commit", "-m", "base changed"]);
      await assert.rejects(() => mergeApprovedReleaseCandidate(mergeDb, "task-1", "2026-06-18T06:00:00.000Z", audit), /changed since release candidate/);
    } finally {
      mergeDb.close();
    }

    const conflict = await repoFixture("conflicts");
    const conflictDb = dbFixture(conflict.root, conflict.worktreeRoot);
    try {
      const first = await insertProposal(conflictDb, { id: "proposal-conflict-1", taskId: "task-1", agentId: "specialist-backend", projectId: "project-1", rootPath: conflict.root, filePath: "same.ts", operation: "CREATE", proposedContent: "export const owner = 'backend';\n", reason: "Backend file", now });
      const second = await insertProposal(conflictDb, { id: "proposal-conflict-2", taskId: "task-1", agentId: "specialist-frontend", projectId: "project-1", rootPath: conflict.root, filePath: "same.ts", operation: "CREATE", proposedContent: "export const owner = 'frontend';\n", reason: "Frontend file", now });
      conflictDb.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id IN (?,?)").run(first.id, second.id);
      await createTaskGitWorkflow(conflictDb, "task-1", { mode: "WORKTREE", now, audit });
      await assert.rejects(() => applyApprovedProposalsToGitWorkflow(conflictDb, "task-1", "2026-06-18T02:00:00.000Z", audit), /conflicts/);
    } finally {
      conflictDb.close();
    }
  });

  it("rolls back task branch changes, cleans only recorded worktrees, and recovers interrupted workflows", async () => {
    const { root, worktreeRoot } = await repoFixture("rollback");
    const db = dbFixture(root, worktreeRoot);
    try {
      await addApprovedProposal(db, root, "task-1");
      await createTaskGitWorkflow(db, "task-1", { mode: "WORKTREE", now, audit });
      await applyApprovedProposalsToGitWorkflow(db, "task-1", "2026-06-18T02:00:00.000Z", audit);
      const workflow = db.prepare("SELECT id,worktree_path AS worktreePath FROM task_git_workflows WHERE task_id='task-1'").get() as { id: string; worktreePath: string };
      assert.match(await fs.readFile(path.join(workflow.worktreePath, "created.ts"), "utf8"), /created/);
      await rollbackGitWorkflow(db, "task-1", "2026-06-18T03:00:00.000Z", audit);
      await assert.rejects(() => fs.readFile(path.join(workflow.worktreePath, "created.ts"), "utf8"));
      await cleanupTaskWorktree(db, "task-1", "2026-06-18T04:00:00.000Z", audit);
      await assert.rejects(() => fs.stat(workflow.worktreePath));

      db.prepare("UPDATE task_git_workflows SET status='CHECKING',updated_at=? WHERE id=?").run("2026-06-18T05:00:00.000Z", workflow.id);
      await recoverGitWorkflow(db, "task-1", "2026-06-18T06:00:00.000Z", audit);
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM git_workflow_events WHERE event_type='GIT_WORKFLOW_RECOVERY'").get() as { count: number }).count > 0);
    } finally {
      db.close();
    }

    const other = await repoFixture("cleanup-block");
    const cleanupDb = dbFixture(other.root, other.worktreeRoot);
    try {
      await assert.rejects(() => cleanupTaskWorktree(cleanupDb, "task-1", now, audit), /No App Studio worktree/);
    } finally {
      cleanupDb.close();
    }
  });
});
