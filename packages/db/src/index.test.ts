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
});
