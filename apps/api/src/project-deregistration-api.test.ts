import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-deregister-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const [{ app }, { db }] = await Promise.all([import("./server.js"), import("@s4/db")]);

async function projectFolder(label: string) {
  const root = await fs.mkdtemp(path.join(workspaceRoot, `${label}-`));
  await fs.writeFile(path.join(root, "keep.txt"), "keep me\n", "utf8");
  return root;
}

after(async () => {
  await app.close();
  db.close();
  delete process.env.S4_DB_PATH;
  delete process.env.NODE_ENV;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("project de-registration API", () => {
  it("deregisters a project without deleting files or historical records", async () => {
    const root = await projectFolder("project-1");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-1", "Fixture", root, "ACTIVE", now, now);
    db.prepare("INSERT INTO tasks (id,project_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("task-1", "project-1", "Historical task", "Preserve history", "COMPLETED", "low", "{}", now, now);
    db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?)").run("approval-1", "task-1", "PROJECT_DELETE", "Historical approval", "{}", "low", "APPROVED", now);

    const response = await app.inject({ method: "DELETE", url: "/api/projects/project-1" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; alreadyDeregistered: boolean };
    assert.equal(body.status, "DEREGISTERED");
    assert.equal(body.alreadyDeregistered, false);

    const row = db.prepare("SELECT status,deregistered_at AS deregisteredAt FROM projects WHERE id='project-1'").get() as { status: string; deregisteredAt: string | null };
    assert.equal(row.status, "DEREGISTERED");
    assert.ok(row.deregisteredAt);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE task_id='task-1'").get() as { count: number }).count, 1);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
    const auditEvent = db.prepare("SELECT event_type AS eventType,COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_DEREGISTERED' AND project_id='project-1'").get() as { eventType: string; count: number };
    assert.equal(auditEvent.eventType, "PROJECT_DEREGISTERED");
    assert.equal(auditEvent.count, 1);
  });

  it("returns 404 for unknown projects and remains safe on repeat requests", async () => {
    const root = await projectFolder("project-2");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-2", "Fixture", root, "ACTIVE", now, now);

    const missing = await app.inject({ method: "DELETE", url: "/api/projects/missing" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "Project not found");

    const first = await app.inject({ method: "DELETE", url: "/api/projects/project-2" });
    assert.equal(first.statusCode, 200);
    const second = await app.inject({ method: "DELETE", url: "/api/projects/project-2" });
    assert.equal(second.statusCode, 200);
    assert.equal((second.json() as { alreadyDeregistered: boolean }).alreadyDeregistered, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_DEREGISTERED' AND project_id='project-2'").get() as { count: number }).count, 1);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
  });
});
