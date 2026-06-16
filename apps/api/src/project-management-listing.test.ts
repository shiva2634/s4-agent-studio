import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-project-listing-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const [{ app }, { db }] = await Promise.all([import("./server.js"), import("@s4/db")]);

after(async () => {
  await app.close();
  db.close();
  delete process.env.S4_DB_PATH;
  delete process.env.NODE_ENV;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("project listing behavior", () => {
  it("exposes active projects for selection and active-plus-paused projects for management", async () => {
    const activeAt = "2026-06-16T00:00:00.000Z";
    const pausedAt = "2026-06-16T00:01:00.000Z";
    const archivedAt = "2026-06-16T00:02:00.000Z";
    db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-active", "Active", path.join(workspaceRoot, "active"), "ACTIVE", activeAt, activeAt);
    db.prepare("INSERT INTO projects (id,name,root_path,status,paused_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-paused", "Paused", path.join(workspaceRoot, "paused"), "PAUSED", pausedAt, pausedAt, pausedAt);
    db.prepare("INSERT INTO projects (id,name,root_path,status,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-archived", "Archived", path.join(workspaceRoot, "archived"), "ARCHIVED", archivedAt, archivedAt, archivedAt);
    db.prepare("INSERT INTO projects (id,name,root_path,status,deregistered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-deregistered", "Deregistered", path.join(workspaceRoot, "deregistered"), "DEREGISTERED", archivedAt, archivedAt, archivedAt);

    const response = await app.inject({ method: "GET", url: "/api/bootstrap" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { projects: Array<{ id: string; status: string }>; manageableProjects: Array<{ id: string; status: string }> };

    assert.deepEqual(body.projects.map((project) => project.id), ["project-active"]);
    assert.deepEqual(body.manageableProjects.map((project) => project.id), ["project-archived", "project-paused", "project-active"]);
    assert.equal(body.manageableProjects.some((project) => project.id === "project-archived"), true);
    assert.equal(body.manageableProjects.some((project) => project.id === "project-deregistered"), false);
  });
});
