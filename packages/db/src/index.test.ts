import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

async function loadInitializer() {
  return await import("./index.js");
}

function createOldProjectsDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      deregistered_at TEXT,
      deregistered_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES ('project-1','Legacy','/tmp/legacy','ACTIVE','created','created');
  `);
  return db;
}

function createLegacyTaskDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      agent_id TEXT,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNING',
      risk_level TEXT NOT NULL DEFAULT 'low',
      plan_json TEXT NOT NULL,
      acceptance_criteria TEXT,
      rollback_plan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      decision_note TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL
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
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      git_checkpoint_json TEXT,
      safety_summary_json TEXT,
      check_results_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES ('project-legacy','Legacy Project','/tmp/legacy-task','ACTIVE','created','created');
    INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at)
      VALUES ('task-legacy','project-legacy',NULL,'developer','Legacy Task','Preserve this row','PLANNING','low','{}','created','created');
  `);
  return db;
}

describe("database initialization", () => {
  it("migrates project lifecycle columns without disturbing existing rows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-db-migrate-"));
    const dbPath = path.join(root, "projects.db");
    const db = createOldProjectsDb(dbPath);
    const dummyPath = path.join(root, "dummy.db");
    process.env.S4_DB_PATH = dummyPath;
    let importedDb: Database.Database | undefined;

    try {
      const loaded = await loadInitializer();
      importedDb = loaded.db;
      const { initializeDatabaseOn } = loaded;
      initializeDatabaseOn(db);

      const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      assert.ok(columns.some((column) => column.name === "paused_at"));
      assert.ok(columns.some((column) => column.name === "archived_at"));
      assert.ok(columns.some((column) => column.name === "deregistered_at"));

      const row = db.prepare("SELECT status,paused_at AS pausedAt,archived_at AS archivedAt,deregistered_at AS deregisteredAt FROM projects WHERE id='project-1'").get() as { status: string; pausedAt: string | null; archivedAt: string | null; deregisteredAt: string | null };
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.pausedAt, null);
      assert.equal(row.archivedAt, null);
      assert.equal(row.deregisteredAt, null);
    } finally {
      importedDb?.close();
      db.close();
      await fs.rm(root, { recursive: true, force: true });
      delete process.env.S4_DB_PATH;
    }
  });

  it("defaults new projects to active and accepts all lifecycle statuses", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      db.prepare("INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)").run("project-1", "Default", "/tmp/default", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,paused_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-2", "Paused", "/tmp/paused", "PAUSED", "paused-at", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-3", "Archived", "/tmp/archived", "ARCHIVED", "archived-at", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,deregistered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-4", "Removed", "/tmp/removed", "DEREGISTERED", "deregistered-at", "created", "created");

      const rows = db.prepare("SELECT id,status,paused_at AS pausedAt,archived_at AS archivedAt,deregistered_at AS deregisteredAt FROM projects ORDER BY id").all() as Array<{ id: string; status: string; pausedAt: string | null; archivedAt: string | null; deregisteredAt: string | null }>;
      assert.deepEqual(rows.map((row) => row.status), ["ACTIVE", "PAUSED", "ARCHIVED", "DEREGISTERED"]);
      assert.equal(rows[0]?.status, "ACTIVE");
      assert.equal(rows[1]?.pausedAt, "paused-at");
      assert.equal(rows[2]?.archivedAt, "archived-at");
      assert.equal(rows[3]?.deregisteredAt, "deregistered-at");
    } finally {
      db.close();
    }
  });

  it("adds task continuation and history columns without disturbing legacy task rows", async () => {
    const db = createLegacyTaskDb();
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      assert.ok(taskColumns.some((column) => column.name === "id"));

      const proposalColumns = db.prepare("PRAGMA table_info(change_proposals)").all() as Array<{ name: string }>;
      assert.ok(proposalColumns.some((column) => column.name === "task_round_id"));

      const approvalColumns = db.prepare("PRAGMA table_info(approvals)").all() as Array<{ name: string }>;
      assert.ok(approvalColumns.some((column) => column.name === "task_round_id"));

      const executionColumns = db.prepare("PRAGMA table_info(task_executions)").all() as Array<{ name: string }>;
      assert.ok(executionColumns.some((column) => column.name === "task_round_id"));

      const roundColumns = db.prepare("PRAGMA table_info(task_rounds)").all() as Array<{ name: string }>;
      assert.ok(roundColumns.some((column) => column.name === "round_number"));
      assert.ok(roundColumns.some((column) => column.name === "next_required_action"));

      const scaffoldJobColumns = db.prepare("PRAGMA table_info(scaffold_jobs)").all() as Array<{ name: string }>;
      assert.ok(scaffoldJobColumns.some((column) => column.name === "target_root_path"));
      assert.ok(scaffoldJobColumns.some((column) => column.name === "approval_id"));

      const templateCount = db.prepare("SELECT COUNT(*) AS count FROM scaffold_templates").get() as { count: number };
      assert.equal(templateCount.count, 6);

      const workspaceRoot = db.prepare("SELECT status FROM workspace_root_config WHERE id='default-local-workspace'").get() as { status: string };
      assert.equal(workspaceRoot.status, "ACTIVE");

      const legacyTask = db.prepare("SELECT title,status FROM tasks WHERE id='task-legacy'").get() as { title: string; status: string };
      assert.equal(legacyTask.title, "Legacy Task");
      assert.equal(legacyTask.status, "PLANNING");
    } finally {
      db.close();
    }
  });
});
