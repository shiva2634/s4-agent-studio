import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyApprovedProposals, insertProposal, validateProposalPath } from "./change-proposals.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE change_proposals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      original_content TEXT,
      original_content_hash TEXT,
      proposed_content TEXT,
      unified_diff TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO tasks (id,project_id,status,updated_at) VALUES (?,?,?,?)").run("task-1", "project-1", "AWAITING_APPROVAL", "now");
  db.prepare("INSERT INTO approvals (id,task_id,status) VALUES (?,?,?)").run("approval-1", "task-1", "APPROVED");
  return db;
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-proposals-"));
  await fs.writeFile(path.join(root, "existing.txt"), "before\n", "utf8");
  return root;
}

describe("change proposal path validation", () => {
  it("rejects traversal", () => {
    assert.throws(() => validateProposalPath("C:/workspace/project", "../outside.txt"), /traversal|relative/);
  });

  it("rejects external absolute paths", () => {
    assert.throws(() => validateProposalPath("C:/workspace/project", "C:/workspace/other/file.txt"), /relative/);
  });

  it("rejects .env files", () => {
    assert.throws(() => validateProposalPath("C:/workspace/project", ".env"), /Secret files/);
  });

  it("rejects node_modules paths", () => {
    assert.throws(() => validateProposalPath("C:/workspace/project", "node_modules/pkg/index.js"), /blocked project directory/);
  });
});

describe("change proposal application", () => {
  it("rejects stale file hashes", async () => {
    const db = createTestDb();
    const root = await createFixture();
    await insertProposal(db, {
      id: "proposal-1",
      taskId: "task-1",
      projectId: "project-1",
      rootPath: root,
      filePath: "existing.txt",
      operation: "UPDATE",
      proposedContent: "after\n",
      reason: "test update",
      now: "now"
    });
    db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id='proposal-1'").run();
    await fs.writeFile(path.join(root, "existing.txt"), "changed elsewhere\n", "utf8");

    await assert.rejects(() => applyApprovedProposals(db, root, "task-1", "later", () => undefined), /changed after proposal creation/);
  });

  it("applies approved proposals and records audit events", async () => {
    const db = createTestDb();
    const root = await createFixture();
    await insertProposal(db, {
      id: "proposal-1",
      taskId: "task-1",
      projectId: "project-1",
      rootPath: root,
      filePath: "existing.txt",
      operation: "UPDATE",
      proposedContent: "after\n",
      reason: "test update",
      now: "now"
    });
    db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id='proposal-1'").run();
    const events: string[] = [];

    const result = await applyApprovedProposals(db, root, "task-1", "later", (eventType) => events.push(eventType));

    assert.equal(result.applied, 1);
    assert.equal(await fs.readFile(path.join(root, "existing.txt"), "utf8"), "after\n");
    assert.deepEqual(events, ["CHANGE_PROPOSAL_APPLIED"]);
  });

  it("does not apply rejected proposals", async () => {
    const db = createTestDb();
    const root = await createFixture();
    await insertProposal(db, {
      id: "proposal-1",
      taskId: "task-1",
      projectId: "project-1",
      rootPath: root,
      filePath: "existing.txt",
      operation: "UPDATE",
      proposedContent: "after\n",
      reason: "test update",
      now: "now"
    });
    db.prepare("UPDATE change_proposals SET status='REJECTED' WHERE id='proposal-1'").run();

    await assert.rejects(() => applyApprovedProposals(db, root, "task-1", "later", () => undefined), /No approved proposals/);
    assert.equal(await fs.readFile(path.join(root, "existing.txt"), "utf8"), "before\n");
  });
});
