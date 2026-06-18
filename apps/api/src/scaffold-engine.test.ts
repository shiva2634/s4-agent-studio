import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { initializeDatabaseOn } from "@s4/db";
import { applyTaskProposals, recoverTaskExecution, rollbackTask } from "./proposal-execution.js";
import { createScaffoldJob, generateScaffoldProposals, getScaffoldJob, listScaffoldTemplates, previewScaffoldTemplate } from "./scaffold-engine.js";
import { insertProposal } from "./change-proposals.js";

const roots: string[] = [];
const now = "2026-06-18T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspaceRoot(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `s4-scaffold-${label}-`));
  roots.push(root);
  return root;
}

function audit(db: Database.Database) {
  return (eventType: string, summary: string, values: { projectId?: string; taskId?: string; payload?: unknown } = {}) => {
    db.prepare("INSERT INTO audit_events (id,project_id,task_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), values.projectId ?? null, values.taskId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, now);
  };
}

function dbFixture(root: string) {
  const db = new Database(":memory:");
  initializeDatabaseOn(db);
  db.prepare("UPDATE workspace_root_config SET root_path=?,status='ACTIVE',is_default=1 WHERE id='default-local-workspace'").run(root);
  return db;
}

function createStaticJob(db: Database.Database, input: Partial<Parameters<typeof createScaffoldJob>[1]> = {}) {
  return createScaffoldJob(db, {
    id: input.id ?? crypto.randomUUID(),
    templateId: input.templateId ?? "static-landing-page",
    projectName: input.projectName ?? "Static Site",
    targetDirectoryName: input.targetDirectoryName ?? "static-site",
    mode: input.mode ?? "CREATE_PROJECT",
    existingProjectId: input.existingProjectId,
    moduleName: input.moduleName,
    planningOnly: input.planningOnly,
    now,
    audit: audit(db)
  });
}

function approveScaffoldRound(db: Database.Database, job: { taskId: string; approvalId: string | null }) {
  assert.ok(job.approvalId);
  db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE task_id=?").run(job.taskId);
  db.prepare("UPDATE approvals SET status='APPROVED',decided_at=? WHERE id=?").run("2026-06-18T01:00:00.000Z", job.approvalId);
}

function insertTemplate(db: Database.Database, id: string, files: Array<[string, string]>) {
  db.prepare(`INSERT INTO scaffold_templates
    (id,name,description,project_type,default_folders_json,package_scripts_json,starter_files_json,recommended_specialist_agents_json,risk_level,allowed_operations_json,required_approvals_json,metadata_json,is_builtin,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, id, "Unsafe template", "test", "[]", "{}", JSON.stringify(files.map(([filePath, content]) => ({ path: filePath, content }))), JSON.stringify(["PRODUCT_PLANNER"]), "low", JSON.stringify(["CREATE"]), JSON.stringify(["HUMAN_APPROVAL"]), "{}", 0, now, now);
}

describe("scaffold engine", () => {
  it("lists built-in scaffold templates and previews starter files without writing", async () => {
    const root = await workspaceRoot("list");
    const db = dbFixture(root);
    try {
      const templates = listScaffoldTemplates(db);
      assert.deepEqual(templates.map((template) => template.id).sort(), [
        "empty-governed-project",
        "full-stack-web-api",
        "internal-tool-admin",
        "nextjs-web-app",
        "node-fastify-api",
        "static-landing-page"
      ].sort());
      const preview = previewScaffoldTemplate(db, "static-landing-page");
      assert.equal(preview.writesFiles, false);
      assert.ok(preview.template.starterFiles.some((file) => file.path === "index.html"));
      await assert.rejects(() => fs.stat(path.join(root, "static-site")));
    } finally {
      db.close();
    }
  });

  it("creates scaffold proposals but writes no files before approval and apply", async () => {
    const root = await workspaceRoot("proposals");
    const db = dbFixture(root);
    try {
      const job = createStaticJob(db);
      assert.equal((db.prepare("SELECT status FROM projects WHERE id=?").get(job.targetProjectId) as { status: string }).status, "PAUSED");
      const generated = await generateScaffoldProposals(db, job.id, { now, audit: audit(db) });
      assert.equal(generated.status, "AWAITING_APPROVAL");
      assert.equal(generated.files.length, 4);
      await assert.rejects(() => fs.stat(path.join(root, "static-site", "index.html")));
      await assert.rejects(() => applyTaskProposals(db, generated.taskId, "2026-06-18T01:30:00.000Z", audit(db)), /approved task approval/);
    } finally {
      db.close();
    }
  });

  it("requires approval before applying scaffold files and registers after apply", async () => {
    const root = await workspaceRoot("apply");
    const db = dbFixture(root);
    try {
      const job = await generateScaffoldProposals(db, createStaticJob(db).id, { now, audit: audit(db) });
      approveScaffoldRound(db, job);
      const result = await applyTaskProposals(db, job.taskId, "2026-06-18T02:00:00.000Z", audit(db));
      assert.equal(result.status, "COMPLETED");
      assert.match(await fs.readFile(path.join(root, "static-site", "index.html"), "utf8"), /Landing Page/);
      assert.equal((db.prepare("SELECT status FROM projects WHERE id=?").get(job.targetProjectId) as { status: string }).status, "ACTIVE");
      assert.equal(getScaffoldJob(db, job.id).status, "REGISTERED");
    } finally {
      db.close();
    }
  });

  it("blocks traversal, external paths, .env, secrets, node_modules, and unsafe scripts", async () => {
    const root = await workspaceRoot("blocked");
    const db = dbFixture(root);
    try {
      assert.throws(() => createStaticJob(db, { targetDirectoryName: "../escape" }), /traversal/);
      assert.throws(() => createStaticJob(db, { targetDirectoryName: path.resolve(root, "escape") }), /relative/);
      for (const [id, filePath] of [["env-template", ".env"], ["secret-template", "src/api-secret.txt"], ["modules-template", "node_modules/pkg/index.js"], ["traversal-template", "../escape.txt"]] as const) {
        insertTemplate(db, id, [[filePath, "blocked\n"]]);
        assert.throws(() => createStaticJob(db, { templateId: id, targetDirectoryName: id }), /Secret files|blocked project directory|traversal/);
      }
      insertTemplate(db, "unsafe-script", [["package.json", JSON.stringify({ scripts: { test: "rm -rf ." } })]]);
      assert.throws(() => createStaticJob(db, { templateId: "unsafe-script", targetDirectoryName: "unsafe-script" }), /Unsafe package script/);
    } finally {
      db.close();
    }
  });

  it("rejects duplicate active project paths and reuses only deregistered records", async () => {
    const root = await workspaceRoot("duplicate");
    const db = dbFixture(root);
    try {
      const target = path.join(root, "static-site");
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("active-project", "Active", target, "ACTIVE", now, now);
      assert.throws(() => createStaticJob(db), /already registered/);
      db.prepare("UPDATE projects SET status='DEREGISTERED',deregistered_at=? WHERE id='active-project'").run(now);
      const job = createStaticJob(db);
      assert.equal(job.targetProjectId, "active-project");
      assert.equal((db.prepare("SELECT status FROM projects WHERE id='active-project'").get() as { status: string }).status, "PAUSED");
    } finally {
      db.close();
    }
  });

  it("rolls back only scaffold files and records scaffold rollback", async () => {
    const root = await workspaceRoot("rollback");
    const db = dbFixture(root);
    try {
      const job = await generateScaffoldProposals(db, createStaticJob(db).id, { now, audit: audit(db) });
      approveScaffoldRound(db, job);
      await applyTaskProposals(db, job.taskId, "2026-06-18T02:00:00.000Z", audit(db));
      await fs.writeFile(path.join(root, "static-site", "manual.txt"), "keep\n");
      const result = await rollbackTask(db, job.taskId, "2026-06-18T03:00:00.000Z", audit(db));
      assert.equal(result.status, "ROLLED_BACK");
      await assert.rejects(() => fs.stat(path.join(root, "static-site", "index.html")));
      assert.equal(await fs.readFile(path.join(root, "static-site", "manual.txt"), "utf8"), "keep\n");
      assert.equal(getScaffoldJob(db, job.id).status, "ROLLED_BACK");
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='SCAFFOLD_ROLLBACK'").get() as { count: number }).count > 0);
    } finally {
      db.close();
    }
  });

  it("recovers interrupted scaffold execution and registers the project", async () => {
    const root = await workspaceRoot("recover");
    const db = dbFixture(root);
    try {
      const job = await generateScaffoldProposals(db, createStaticJob(db).id, { now, audit: audit(db) });
      approveScaffoldRound(db, job);
      await applyTaskProposals(db, job.taskId, "2026-06-18T02:00:00.000Z", audit(db));
      db.prepare("UPDATE task_executions SET status='APPLYING' WHERE task_id=?").run(job.taskId);
      db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE task_id=?").run(job.taskId);
      db.prepare("UPDATE scaffold_jobs SET status='AWAITING_APPROVAL' WHERE id=?").run(job.id);
      const result = await recoverTaskExecution(db, job.taskId, "2026-06-18T03:00:00.000Z", audit(db));
      assert.equal(result.status, "COMPLETED");
      assert.equal(getScaffoldJob(db, job.id).status, "REGISTERED");
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='SCAFFOLD_RECOVERY'").get() as { count: number }).count > 0);
    } finally {
      db.close();
    }
  });

  it("supports planning-only and add-module flows without direct file writes", async () => {
    const root = await workspaceRoot("flows");
    const db = dbFixture(root);
    try {
      const planningJob = createStaticJob(db, { id: "planning-job", projectName: "Plan Only", targetDirectoryName: "plan-only", planningOnly: true });
      await generateScaffoldProposals(db, planningJob.id, { now, audit: audit(db), planningOnly: true });
      assert.equal(getScaffoldJob(db, planningJob.id).files.length, 0);
      await assert.rejects(() => fs.stat(path.join(root, "plan-only", "index.html")));

      const existingRoot = path.join(root, "existing");
      await fs.mkdir(existingRoot, { recursive: true });
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-existing", "Existing", existingRoot, "ACTIVE", now, now);
      const moduleJob = createStaticJob(db, { id: "module-job", mode: "ADD_MODULE", existingProjectId: "project-existing", moduleName: "modules/landing", projectName: "Landing Module" });
      const generated = await generateScaffoldProposals(db, moduleJob.id, { now, audit: audit(db) });
      assert.ok(generated.files.every((file: { relativePath: string }) => file.relativePath.startsWith("modules/landing/")));
      await assert.rejects(() => fs.stat(path.join(existingRoot, "modules", "landing", "index.html")));
    } finally {
      db.close();
    }
  });

  it("preserves existing registration, developer proposals, specialist orchestration, and unrelated changes", async () => {
    const root = await workspaceRoot("compat");
    const db = dbFixture(root);
    try {
      const existingRoot = path.join(root, "registered");
      await fs.mkdir(existingRoot, { recursive: true });
      await fs.writeFile(path.join(existingRoot, "package.json"), JSON.stringify({ scripts: { test: "node tests/smoke.mjs" } }));
      await fs.mkdir(path.join(existingRoot, "tests"), { recursive: true });
      await fs.writeFile(path.join(existingRoot, "tests", "smoke.mjs"), "import assert from 'node:assert/strict';\nassert.ok(true);\n");
      await fs.writeFile(path.join(existingRoot, "manual.txt"), "keep\n");
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-existing", "Existing", existingRoot, "ACTIVE", now, now);
      db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("task-existing", "project-existing", null, "developer", "Existing task", "Keep working", "AWAITING_APPROVAL", "low", "{}", now, now);
      db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("approval-existing", "task-existing", "CHANGE_PROPOSAL", "Approve", "{}", "low", "APPROVED", "2026-06-18T01:00:00.000Z", now);
      await insertProposal(db, { id: "proposal-existing", taskId: "task-existing", projectId: "project-existing", rootPath: existingRoot, filePath: "created.txt", operation: "CREATE", proposedContent: "created\n", reason: "Developer workflow", now });
      db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id='proposal-existing'").run();
      await applyTaskProposals(db, "task-existing", "2026-06-18T02:00:00.000Z", audit(db));
      assert.equal(await fs.readFile(path.join(existingRoot, "created.txt"), "utf8"), "created\n");
      assert.equal(await fs.readFile(path.join(existingRoot, "manual.txt"), "utf8"), "keep\n");

      const scaffoldJob = await generateScaffoldProposals(db, createStaticJob(db, { id: "compat-job", targetDirectoryName: "compat-static" }).id, { now, audit: audit(db) });
      assert.ok(scaffoldJob.files.length > 0);
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=?").get(scaffoldJob.taskId) as { count: number }).count > 0);
    } finally {
      db.close();
    }
  });
});
