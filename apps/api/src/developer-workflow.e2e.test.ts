import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

const execFileAsync = promisify(execFile);

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-dev-workflow-"));
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  S4_DB_PATH: process.env.S4_DB_PATH,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
  AI_MAX_RETRIES: process.env.AI_MAX_RETRIES
};
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");
process.env.AI_PROVIDER = "nvidia";
process.env.AI_API_KEY = "test-secret";
process.env.AI_MODEL = "mock-model";
process.env.AI_BASE_URL = "https://provider.test/v1";
process.env.AI_TIMEOUT_MS = "5000";
process.env.AI_MAX_RETRIES = "0";

const originalFetch = global.fetch;
global.fetch = (async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const userMessage = body.messages?.[1]?.content ? JSON.parse(body.messages[1].content) : null;
  const output = {
    summary: "Add dashboard panel and update existing helper",
    plan: ["Inspect current components", "Create a new panel", "Update the existing helper", "Add tests"],
    proposals: [
      {
        relativePath: "created.ts",
        operation: "CREATE",
        proposedContent: "export const created = true;\n",
        reason: "Add a new dashboard panel helper"
      },
      {
        relativePath: "existing.ts",
        operation: "UPDATE",
        proposedContent: "export const value = 'after';\n",
        reason: "Update the existing helper for the new panel"
      }
    ],
    assumptions: [userMessage?.userObjective ?? "None"],
    requiredTests: ["npm run typecheck", "npm test"],
    warnings: []
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const [{ app }, { db }] = await Promise.all([import("./server.js"), import("@s4/db")]);

async function gitInit(root: string) {
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "s4@example.test"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "S4"], { cwd: root, windowsHide: true });
}

async function createTestProject(label = "project") {
  const root = path.join(workspaceRoot, label);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "workflow-project",
    scripts: {
      typecheck: "node scripts/pass.cjs",
      test: "node scripts/pass.cjs",
      build: "node scripts/pass.cjs",
      lint: "node scripts/pass.cjs"
    }
  }, null, 2));
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "process.exit(0);\n");
  await fs.writeFile(path.join(root, "existing.ts"), "export const value = 'before';\n");
  await fs.writeFile(path.join(root, "src", "index.ts"), "export const index = true;\n");
  await gitInit(root);
  await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root, windowsHide: true });
  return root;
}

after(async () => {
  global.fetch = originalFetch;
  await app.close();
  db.close();
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  process.env.S4_DB_PATH = originalEnv.S4_DB_PATH;
  process.env.AI_PROVIDER = originalEnv.AI_PROVIDER;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_TIMEOUT_MS = originalEnv.AI_TIMEOUT_MS;
  process.env.AI_MAX_RETRIES = originalEnv.AI_MAX_RETRIES;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("developer agent workflow", () => {
  it("inspects a project, generates proposals, applies them with approval, checks, rollback, and preserves safety gates", async () => {
    const root = await createTestProject();
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Workflow Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };

    const tree = await app.inject({ method: "GET", url: `/api/projects/${project.id}/tree?path=.` });
    assert.equal(tree.statusCode, 200);
    const treeBody = tree.json() as { entries: Array<{ path: string }> };
    assert.ok(treeBody.entries.some((entry) => entry.path === "package.json"));
    assert.ok(treeBody.entries.some((entry) => entry.path === "existing.ts"));

    const file = await app.inject({ method: "GET", url: `/api/projects/${project.id}/file?path=existing.ts` });
    assert.equal(file.statusCode, 200);
    assert.match((file.json() as { content: string }).content, /before/);

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { projectId: project.id, message: "Add a dashboard panel and update the existing helper so the workspace shows execution results." }
    });
    assert.equal(chat.statusCode, 200);
    const chatBody = chat.json() as { taskId: string; approvalId: string | null; approvalRequired: boolean; nextStep: string; plan: { proposals: Array<{ operation: string; relativePath?: string }> } };
    assert.equal(chatBody.approvalRequired, true);
    assert.equal(chatBody.nextStep, "AWAITING_APPROVAL");
    assert.equal(chatBody.plan.proposals.length, 2);
    assert.deepEqual(chatBody.plan.proposals.map((proposal) => proposal.operation), ["CREATE", "UPDATE"]);

    const proposalsResponse = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    assert.equal(proposalsResponse.statusCode, 200);
    const proposals = (proposalsResponse.json() as { proposals: Array<{ id: string; filePath: string; status: string; operation: string }> }).proposals;
    assert.equal(proposals.length, 2);
    assert.deepEqual(proposals.map((proposal) => proposal.filePath), ["created.ts", "existing.ts"]);
    assert.ok(proposals.every((proposal) => proposal.status === "PENDING"));

    const approval = await app.inject({ method: "POST", url: `/api/approvals/${chatBody.approvalId}/decision`, payload: { decision: "APPROVED" } });
    assert.equal(approval.statusCode, 200);

    for (const proposal of proposals) {
      const approved = await app.inject({ method: "POST", url: `/api/proposals/${proposal.id}/approve`, payload: {} });
      assert.equal(approved.statusCode, 200);
    }

    const preApply = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/execution` });
    const preApplyBody = preApply.json() as { executions: Array<{ status: string }>; appliedFiles: Array<unknown> };
    assert.equal(preApplyBody.executions.length, 0);
    assert.equal(preApplyBody.appliedFiles.length, 0);

    const apply = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/apply` });
    assert.equal(apply.statusCode, 200);
    const applyBody = apply.json() as { status: string; applied: number; checkResults: Array<{ name: string; ok: boolean }> };
    assert.equal(applyBody.status, "COMPLETED");
    assert.equal(applyBody.applied, 2);
    assert.ok(applyBody.checkResults.length > 0);
    assert.ok(applyBody.checkResults.every((result) => result.ok));
    assert.match(await fs.readFile(path.join(root, "existing.ts"), "utf8"), /after/);
    assert.match(await fs.readFile(path.join(root, "created.ts"), "utf8"), /created/);

    const checks = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/run-checks`, payload: {} });
    assert.equal(checks.statusCode, 200);
    const checksBody = checks.json() as { status: string; checkResults: Array<{ name: string; ok: boolean }> };
    assert.equal(checksBody.status, "CHECKS_PASSED");
    assert.ok(checksBody.checkResults.every((result) => result.ok));

    const execution = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/execution` });
    const executionBody = execution.json() as { executions: Array<{ status: string; checkResultsJson: string | null }>; appliedFiles: Array<{ filePath: string; operation: string; result: string }> };
    assert.equal(executionBody.executions[0]?.status, "CHECKS_PASSED");
    assert.ok(executionBody.executions[0]?.checkResultsJson);
    assert.deepEqual(executionBody.appliedFiles.map((file) => file.filePath), ["created.ts", "existing.ts"]);

    const audit = await app.inject({ method: "GET", url: "/api/audit" });
    const auditEvents = (audit.json() as { events: Array<{ eventType: string; summary: string }> }).events;
    assert.ok(auditEvents.some((event) => event.eventType === "CODE_PROPOSAL_CREATED"));
    assert.ok(auditEvents.some((event) => event.eventType === "APPROVAL_DECIDED"));
    assert.ok(auditEvents.some((event) => event.eventType === "CHANGE_PROPOSAL_APPLIED"));

    const rollback = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/rollback` });
    assert.equal(rollback.statusCode, 200);
    const rollbackBody = rollback.json() as { status: string; rolledBack: number };
    assert.equal(rollbackBody.status, "ROLLED_BACK");
    assert.equal(rollbackBody.rolledBack, 2);
    assert.match(await fs.readFile(path.join(root, "existing.ts"), "utf8"), /before/);
    await assert.rejects(() => fs.readFile(path.join(root, "created.ts"), "utf8"));
    const rollbackAudit = await app.inject({ method: "GET", url: "/api/audit" });
    assert.ok((rollbackAudit.json() as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "TASK_ROLLED_BACK"));
  });

  it("blocks development actions for paused, archived, and de-registered projects", async () => {
    const root = await createTestProject("project-two");
    const active = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Active", rootPath: root } });
    const activeProject = active.json() as { id: string };
    const pausedRoot = path.join(workspaceRoot, "paused-project");
    const archivedRoot = path.join(workspaceRoot, "archived-project");
    const deregisteredRoot = path.join(workspaceRoot, "gone-project");
    await Promise.all([fs.mkdir(pausedRoot, { recursive: true }), fs.mkdir(archivedRoot, { recursive: true }), fs.mkdir(deregisteredRoot, { recursive: true })]);
    db.prepare("INSERT INTO projects (id,name,root_path,status,paused_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("paused-project", "Paused", pausedRoot, "PAUSED", "now", "now", "now");
    db.prepare("INSERT INTO projects (id,name,root_path,status,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("archived-project", "Archived", archivedRoot, "ARCHIVED", "now", "now", "now");
    db.prepare("INSERT INTO projects (id,name,root_path,status,deregistered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("gone-project", "Gone", deregisteredRoot, "DEREGISTERED", "now", "now", "now");

    for (const projectId of ["paused-project", "archived-project", "gone-project"]) {
      const chat = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId, message: "Please build a dashboard widget." } });
      assert.equal(chat.statusCode, 404);
      const tree = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tree?path=.` });
      assert.equal(tree.statusCode, 404);
      const file = await app.inject({ method: "GET", url: `/api/projects/${projectId}/file?path=existing.ts` });
      assert.equal(file.statusCode, 404);
    }

    const activeChat = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: activeProject.id, message: "Please build a dashboard widget." } });
    assert.equal(activeChat.statusCode, 200);
  });
});
