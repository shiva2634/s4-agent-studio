import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ProjectRegistrationError, deregisterProject, listActiveProjects, pauseProject, registerOrReactivateProject } from "./project-registration.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      paused_at TEXT,
      archived_at TEXT,
      deregistered_at TEXT,
      deregistered_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

async function projectFolder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-deregister-"));
  await fs.writeFile(path.join(root, "source.ts"), "export const unchanged = true;\n", "utf8");
  return root;
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

describe("project de-registration", () => {
  it("de-registers an active project without touching project files", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    db.prepare("INSERT INTO tasks (id,project_id,title,status,created_at) VALUES (?,?,?,?,?)").run("task-1", "project-1", "Historical task", "COMPLETED", "created");

    const result = deregisterProject(db, "project-1", "later", audit(db));

    assert.equal(result.status, "DEREGISTERED");
    assert.deepEqual(listActiveProjects(db), []);
    assert.equal(await fs.readFile(path.join(root, "source.ts"), "utf8"), "export const unchanged = true;\n");
    assert.ok(await fs.stat(root));
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-1'").get() as { count: number }).count, 1);
    const auditEvent = db.prepare("SELECT event_type AS eventType,payload_json AS payloadJson FROM audit_events WHERE event_type='PROJECT_DEREGISTERED'").get() as { eventType: string; payloadJson: string };
    assert.equal(auditEvent.eventType, "PROJECT_DEREGISTERED");
    assert.equal(JSON.parse(auditEvent.payloadJson).newStatus, "DEREGISTERED");
  });

  it("returns 404 for unknown projects", () => {
    const db = dbFixture();
    assert.throws(() => deregisterProject(db, "missing", "now", audit(db)), (error) => {
      assert.ok(error instanceof ProjectRegistrationError);
      assert.equal(error.statusCode, 404);
      return true;
    });
  });

  it("handles repeated de-registration safely", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    deregisterProject(db, "project-1", "later", audit(db));

    const repeated = deregisterProject(db, "project-1", "again", audit(db));

    assert.equal(repeated.alreadyDeregistered, true);
    assert.equal(repeated.status, "DEREGISTERED");
    assert.equal(await fs.readFile(path.join(root, "source.ts"), "utf8"), "export const unchanged = true;\n");
  });

  it("re-registers the same folder by reactivating the existing record", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    db.prepare("INSERT INTO tasks (id,project_id,title,status,created_at) VALUES (?,?,?,?,?)").run("task-1", "project-1", "Historical task", "COMPLETED", "created");
    deregisterProject(db, "project-1", "later", audit(db));

    const result = registerOrReactivateProject(db, { id: "project-2", name: "Fixture Again", rootPath: root, now: "again" }, audit(db));

    assert.equal(result.reactivated, true);
    assert.equal(result.id, "project-1");
    assert.equal(result.status, "ACTIVE");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_REACTIVATED'").get() as { count: number }).count, 1);
    assert.equal(listActiveProjects(db)[0]?.id, "project-1");
  });

  it("rejects duplicate active project registration", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));

    assert.throws(() => registerOrReactivateProject(db, { id: "project-2", name: "Duplicate", rootPath: root, now: "again" }, audit(db)), (error) => {
      assert.ok(error instanceof ProjectRegistrationError);
      assert.equal(error.statusCode, 409);
      return true;
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count, 1);
  });

  it("pauses an active project and keeps historical records intact", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    db.prepare("INSERT INTO tasks (id,project_id,title,status,created_at) VALUES (?,?,?,?,?)").run("task-1", "project-1", "Historical task", "COMPLETED", "created");

    const result = pauseProject(db, "project-1", "paused", audit(db));

    assert.equal(result.status, "PAUSED");
    assert.equal(result.alreadyPaused, false);
    assert.equal((db.prepare("SELECT status,paused_at AS pausedAt FROM projects WHERE id='project-1'").get() as { status: string; pausedAt: string | null }).status, "PAUSED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_PAUSED'").get() as { count: number }).count, 1);
    assert.equal(listActiveProjects(db).length, 0);
    assert.equal(await fs.readFile(path.join(root, "source.ts"), "utf8"), "export const unchanged = true;\n");
  });

  it("treats repeated pause as safe", async () => {
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    pauseProject(db, "project-1", "paused", audit(db));

    const repeated = pauseProject(db, "project-1", "paused-again", audit(db));

    assert.equal(repeated.alreadyPaused, true);
    assert.equal(repeated.status, "PAUSED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_PAUSED'").get() as { count: number }).count, 1);
  });

  it("handles case-safe duplicate path checks on Windows", async () => {
    if (process.platform !== "win32") return;
    const db = dbFixture();
    const root = await projectFolder();
    registerOrReactivateProject(db, { id: "project-1", name: "Fixture", rootPath: root, now: "created" }, audit(db));
    const upperCased = root.toUpperCase();

    assert.throws(() => registerOrReactivateProject(db, { id: "project-2", name: "Duplicate", rootPath: upperCased, now: "again" }, audit(db)), (error) => {
      assert.ok(error instanceof ProjectRegistrationError);
      assert.equal(error.statusCode, 409);
      return true;
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count, 1);
  });
});
