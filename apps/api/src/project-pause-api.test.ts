import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-pause-api-"));
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

describe("project pause API", () => {
  it("pauses an active project without modifying files and excludes it from active projects", async () => {
    const root = await projectFolder("project-1");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-1", "Fixture", root, "ACTIVE", now, now);
    db.prepare("INSERT INTO tasks (id,project_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("task-1", "project-1", "Historical task", "Keep history", "COMPLETED", "low", "{}", now, now);

    const response = await app.inject({ method: "POST", url: "/api/projects/project-1/pause" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; alreadyPaused: boolean };
    assert.equal(body.status, "PAUSED");
    assert.equal(body.alreadyPaused, false);

    const row = db.prepare("SELECT status,paused_at AS pausedAt FROM projects WHERE id='project-1'").get() as { status: string; pausedAt: string | null };
    assert.equal(row.status, "PAUSED");
    assert.ok(row.pausedAt);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_PAUSED' AND project_id='project-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects WHERE status='ACTIVE'").get() as { count: number }).count, 0);
  });

  it("returns 404 for unknown projects and repeated pause is safe", async () => {
    const root = await projectFolder("project-2");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-2", "Fixture", root, "ACTIVE", now, now);

    const missing = await app.inject({ method: "POST", url: "/api/projects/missing/pause" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "Project not found");

    const first = await app.inject({ method: "POST", url: "/api/projects/project-2/pause" });
    assert.equal(first.statusCode, 200);
    const second = await app.inject({ method: "POST", url: "/api/projects/project-2/pause" });
    assert.equal(second.statusCode, 200);
    assert.equal((second.json() as { alreadyPaused: boolean }).alreadyPaused, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_PAUSED' AND project_id='project-2'").get() as { count: number }).count, 1);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
  });
});

describe("project resume API", () => {
  it("resumes a paused project without modifying files and restores the active list", async () => {
    const root = await projectFolder("project-3");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,paused_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-3", "Fixture", root, "PAUSED", now, now, now);
    db.prepare("INSERT INTO tasks (id,project_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("task-3", "project-3", "Historical task", "Keep history", "COMPLETED", "low", "{}", now, now);

    const response = await app.inject({ method: "POST", url: "/api/projects/project-3/resume" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; alreadyActive: boolean };
    assert.equal(body.status, "ACTIVE");
    assert.equal(body.alreadyActive, false);

    const row = db.prepare("SELECT status,paused_at AS pausedAt FROM projects WHERE id='project-3'").get() as { status: string; pausedAt: string | null };
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.pausedAt, null);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id='project-3'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_RESUMED' AND project_id='project-3'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects WHERE status='ACTIVE'").get() as { count: number }).count, 1);
  });

  it("returns 404 for unknown projects and repeated resume is safe", async () => {
    const root = await projectFolder("project-4");
    const now = "2026-06-16T00:00:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-4", "Fixture", root, "ACTIVE", now, now);

    const missing = await app.inject({ method: "POST", url: "/api/projects/missing/resume" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "Project not found");

    const first = await app.inject({ method: "POST", url: "/api/projects/project-4/resume" });
    assert.equal(first.statusCode, 200);
    assert.equal((first.json() as { alreadyActive: boolean }).alreadyActive, true);
    const second = await app.inject({ method: "POST", url: "/api/projects/project-4/resume" });
    assert.equal(second.statusCode, 200);
    assert.equal((second.json() as { alreadyActive: boolean }).alreadyActive, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='PROJECT_RESUMED' AND project_id='project-4'").get() as { count: number }).count, 0);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep me\n");
  });
});
