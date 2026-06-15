import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { insertProposal } from "./change-proposals.js";
import { applyTaskProposals, rollbackTask, runTaskChecks } from "./proposal-execution.js";
import { runProjectCheck } from "./command-runner.js";

const execFileAsync = promisify(execFile);

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, decided_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, event_type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
    CREATE TABLE change_proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, file_path TEXT NOT NULL, operation TEXT NOT NULL, original_content TEXT, original_content_hash TEXT, proposed_content TEXT, unified_diff TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE task_executions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL, git_checkpoint_json TEXT, safety_summary_json TEXT, check_results_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE applied_file_changes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, proposal_id TEXT NOT NULL, file_path TEXT NOT NULL, operation TEXT NOT NULL, before_hash TEXT, after_hash TEXT, before_content TEXT, after_content TEXT NOT NULL, approval_id TEXT NOT NULL, git_checkpoint_json TEXT, result TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return db;
}

async function projectFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-exec-"));
  await fs.mkdir(path.join(root, "scripts"));
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "process.exit(0);\n");
  await fs.writeFile(path.join(root, "scripts", "fail.cjs"), "process.exit(1);\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      typecheck: "node scripts/pass.cjs",
      test: "node scripts/pass.cjs",
      build: "node scripts/pass.cjs",
      lint: "node scripts/pass.cjs",
      failtest: "node scripts/fail.cjs"
    }
  }));
  await fs.writeFile(path.join(root, "existing.ts"), "export const value = 'before';\n");
  return root;
}

function seedTask(db: Database.Database, root: string, approved = true) {
  db.prepare("INSERT INTO projects (id,root_path) VALUES (?,?)").run("project-1", root);
  db.prepare("INSERT INTO tasks (id,project_id,status,updated_at) VALUES (?,?,?,?)").run("task-1", "project-1", "AWAITING_APPROVAL", "now");
  if (approved) db.prepare("INSERT INTO approvals (id,task_id,status,decided_at,created_at) VALUES (?,?,?,?,?)").run("approval-1", "task-1", "APPROVED", "now", "now");
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; taskId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,task_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, values.taskId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

describe("safe proposal execution", () => {
  it("does not apply pending or rejected proposals", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "pending.ts", operation: "CREATE", proposedContent: "export {}\n", reason: "pending", now: "now" });
    await assert.rejects(() => applyTaskProposals(db, "task-1", "later", audit(db)), /No approved proposals/);
    await assert.rejects(() => fs.readFile(path.join(root, "pending.ts"), "utf8"));
    db.prepare("UPDATE change_proposals SET status='REJECTED' WHERE id='p1'").run();
    await assert.rejects(() => applyTaskProposals(db, "task-1", "later", audit(db)), /No approved proposals/);
  });

  it("applies approved CREATE and UPDATE proposals", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export const created = true;\n", reason: "create", now: "now" });
    await insertProposal(db, { id: "p2", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "existing.ts", operation: "UPDATE", proposedContent: "export const value = 'after';\n", reason: "update", now: "now" });
    db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
    const result = await applyTaskProposals(db, "task-1", "later", audit(db));
    assert.equal(result.status, "COMPLETED");
    assert.match(await fs.readFile(path.join(root, "created.ts"), "utf8"), /created/);
    assert.match(await fs.readFile(path.join(root, "existing.ts"), "utf8"), /after/);
  });

  it("blocks stale hashes and prevents partial application", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export {}\n", reason: "create", now: "now" });
    await insertProposal(db, { id: "p2", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "existing.ts", operation: "UPDATE", proposedContent: "export const value = 'after';\n", reason: "update", now: "now" });
    db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
    await fs.writeFile(path.join(root, "existing.ts"), "changed elsewhere\n");
    await assert.rejects(() => applyTaskProposals(db, "task-1", "later", audit(db)), /changed after proposal creation/);
    await assert.rejects(() => fs.readFile(path.join(root, "created.ts"), "utf8"));
  });

  it("rejects unsafe approved paths and DELETE operations", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    db.prepare("INSERT INTO change_proposals (id,task_id,project_id,file_path,operation,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("p1", "task-1", "project-1", ".env", "CREATE", null, "x", "diff", "unsafe", "APPROVED", "now", "now");
    await assert.rejects(() => applyTaskProposals(db, "task-1", "later", audit(db)), /Secret files/);
    db.prepare("DELETE FROM change_proposals").run();
    db.prepare("INSERT INTO change_proposals (id,task_id,project_id,file_path,operation,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("p2", "task-1", "project-1", "existing.ts", "DELETE", null, null, "diff", "delete", "APPROVED", "now", "now");
    await assert.rejects(() => applyTaskProposals(db, "task-1", "later", audit(db)), /DELETE proposals are disabled/);
  });

  it("preserves unrelated Git changes", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["config", "user.email", "s4@example.test"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["config", "user.name", "S4"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root, windowsHide: true });
    await fs.writeFile(path.join(root, "unrelated.txt"), "keep me\n");
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export {}\n", reason: "create", now: "now" });
    db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
    await applyTaskProposals(db, "task-1", "later", audit(db));
    assert.equal(await fs.readFile(path.join(root, "unrelated.txt"), "utf8"), "keep me\n");
  });

  it("runs allowed scripts and rejects arbitrary commands", async () => {
    const root = await projectFixture();
    const result = await runProjectCheck(root, "TYPECHECK");
    assert.equal(result.ok, true);
    await assert.rejects(() => runProjectCheck(root, "WHOAMI" as never), /Unsupported check action/);
  });

  it("marks task failed when checks fail", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    pkg.scripts.test = "node scripts/fail.cjs";
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export {}\n", reason: "create", now: "now" });
    db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
    const result = await applyTaskProposals(db, "task-1", "later", audit(db));
    assert.equal(result.status, "FAILED_VALIDATION");
    assert.equal((db.prepare("SELECT status FROM tasks WHERE id='task-1'").get() as { status: string }).status, "FAILED_VALIDATION");
  });

  it("rolls back only task files and records audit events", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "existing.ts", operation: "UPDATE", proposedContent: "export const value = 'after';\n", reason: "update", now: "now" });
    db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
    await applyTaskProposals(db, "task-1", "later", audit(db));
    await fs.writeFile(path.join(root, "unrelated.txt"), "keep\n");
    const result = await rollbackTask(db, "task-1", "rollback", audit(db));
    assert.equal(result.status, "ROLLED_BACK");
    assert.match(await fs.readFile(path.join(root, "existing.ts"), "utf8"), /before/);
    assert.equal(await fs.readFile(path.join(root, "unrelated.txt"), "utf8"), "keep\n");
    assert.ok((db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count > 0);
  });

  it("run-checks records failure status", async () => {
    const db = dbFixture(); const root = await projectFixture(); seedTask(db, root);
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    pkg.scripts.typecheck = "node scripts/fail.cjs";
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
    const result = await runTaskChecks(db, "task-1", "later", "TYPECHECK");
    assert.equal(result.status, "CHECKS_FAILED");
  });
});
