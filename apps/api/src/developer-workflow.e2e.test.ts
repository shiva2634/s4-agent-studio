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

async function createTestProject(label = "project", overrides: Partial<{ typecheck: string; test: string; build: string; lint: string }> = {}) {
  const root = path.join(workspaceRoot, label);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  const scripts = {
    typecheck: overrides.typecheck ?? "node scripts/pass.cjs",
    test: overrides.test ?? "node scripts/pass.cjs",
    build: overrides.build ?? "node scripts/pass.cjs",
    lint: overrides.lint ?? "node scripts/pass.cjs"
  };
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "workflow-project",
    scripts
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
    await fs.writeFile(path.join(root, "unrelated.ts"), "export const keepMe = true;\n");
    await fs.writeFile(path.join(root, "unrelated.ts"), "export const keepMe = false;\n");

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
    const executionBody = execution.json() as {
      executions: Array<{ status: string; checkResultsJson: string | null; gitCheckpoint: { available: boolean; branch: string | null; head: string | null; checkpointRef: string | null; dirty: boolean; warning: string | null } | null; rollbackAvailable: boolean; rollbackStatus: string; createdAt: string }>;
      checkpointExecution: { status: string; gitCheckpoint: { available: boolean; branch: string | null; head: string | null; checkpointRef: string | null; dirty: boolean; warning: string | null } | null; rollbackAvailable: boolean; rollbackStatus: string; createdAt: string } | null;
      latestExecution: { status: string; checkResultsJson: string | null; rollbackAvailable: boolean; rollbackStatus: string } | null;
      rollbackAvailable: boolean;
      rollbackStatus: string;
      recoveryOutcome: string | null;
      appliedFiles: Array<{ filePath: string; operation: string; result: string }>;
    };
    assert.equal(executionBody.executions[0]?.status, "CHECKS_PASSED");
    assert.ok(executionBody.executions[0]?.checkResultsJson);
    assert.equal(executionBody.checkpointExecution?.gitCheckpoint?.available, true);
    assert.match(executionBody.checkpointExecution?.gitCheckpoint?.branch ?? "", /.+/);
    assert.match(executionBody.checkpointExecution?.gitCheckpoint?.head ?? "", /^[0-9a-f]{40}$/);
    assert.equal(executionBody.checkpointExecution?.gitCheckpoint?.dirty, true);
    assert.equal(executionBody.checkpointExecution?.rollbackAvailable, true);
    assert.equal(executionBody.rollbackAvailable, true);
    assert.equal(executionBody.rollbackStatus, "AVAILABLE");
    assert.equal(executionBody.recoveryOutcome, "CHECKS_PASSED");
    assert.deepEqual(executionBody.appliedFiles.map((file) => file.filePath), ["created.ts", "existing.ts"]);
    assert.match(executionBody.checkpointExecution?.createdAt ?? "", /T/);
    assert.match(await fs.readFile(path.join(root, "unrelated.ts"), "utf8"), /false/);

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
    const afterRollback = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/execution` });
    const afterRollbackBody = afterRollback.json() as {
      checkpointExecution: { rollbackAvailable: boolean; rollbackStatus: string } | null;
      latestExecution: { status: string; rollbackAvailable: boolean; rollbackStatus: string } | null;
      rollbackAvailable: boolean;
      rollbackStatus: string;
      recoveryOutcome: string | null;
    };
    assert.equal(afterRollbackBody.checkpointExecution?.rollbackAvailable, false);
    assert.equal(afterRollbackBody.latestExecution?.status, "ROLLED_BACK");
    assert.equal(afterRollbackBody.latestExecution?.rollbackStatus, "ROLLED_BACK");
    assert.equal(afterRollbackBody.rollbackAvailable, false);
    assert.equal(afterRollbackBody.rollbackStatus, "ROLLED_BACK");
    assert.equal(afterRollbackBody.recoveryOutcome, "CHECKPOINT_RESTORED");
    assert.match(await fs.readFile(path.join(root, "existing.ts"), "utf8"), /before/);
    await assert.rejects(() => fs.readFile(path.join(root, "created.ts"), "utf8"));
    const rollbackAudit = await app.inject({ method: "GET", url: "/api/audit" });
    assert.ok((rollbackAudit.json() as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "TASK_ROLLED_BACK"));
  });

  it("surfaces recovery data when checks fail and preserves unrelated git changes", async () => {
    const root = await createTestProject("project-failing", { test: "node -e \"process.exit(1)\"" });
    await fs.writeFile(path.join(root, "unrelated.ts"), "export const keepMe = true;\n");
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Failing Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };
    await fs.writeFile(path.join(root, "unrelated.ts"), "export const keepMe = false;\n");

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { projectId: project.id, message: "Add a dashboard panel and keep the repo changes recoverable." }
    });
    assert.equal(chat.statusCode, 200);
    const chatBody = chat.json() as { taskId: string; approvalId: string | null };

    const approval = await app.inject({ method: "POST", url: `/api/approvals/${chatBody.approvalId}/decision`, payload: { decision: "APPROVED" } });
    assert.equal(approval.statusCode, 200);

    const proposalsResponse = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    const proposals = (proposalsResponse.json() as { proposals: Array<{ id: string }> }).proposals;
    for (const proposal of proposals) {
      const approved = await app.inject({ method: "POST", url: `/api/proposals/${proposal.id}/approve`, payload: {} });
      assert.equal(approved.statusCode, 200);
    }

    const apply = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/apply` });
    assert.equal(apply.statusCode, 200);
    const applyBody = apply.json() as { status: string };
    assert.equal(applyBody.status, "FAILED_VALIDATION");

    const execution = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/execution` });
    const executionBody = execution.json() as {
      checkpointExecution: { rollbackAvailable: boolean; rollbackStatus: string } | null;
      latestExecution: { status: string; rollbackAvailable: boolean; rollbackStatus: string; checkResultsJson: string | null } | null;
    };
    assert.equal(executionBody.checkpointExecution?.rollbackAvailable, true);
    assert.equal(executionBody.latestExecution?.status, "FAILED_VALIDATION");
    assert.equal(executionBody.latestExecution?.rollbackStatus, "AVAILABLE");
    assert.ok(executionBody.latestExecution?.checkResultsJson);
    assert.match(await fs.readFile(path.join(root, "unrelated.ts"), "utf8"), /false/);
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

  it("continues the same task across multiple chat turns and records extra proposal rounds", async () => {
    const root = await createTestProject("project-continuation");
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Continuation Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };

    const first = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, message: "Build a dashboard panel and update the existing helper." } });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json() as { taskId: string; approvalId: string | null };
    assert.ok(firstBody.approvalId);

    const second = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, taskId: firstBody.taskId, message: "Continue the same task with a follow-up adjustment." } });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json() as { taskId: string };
    assert.equal(secondBody.taskId, firstBody.taskId);

    const history = await app.inject({ method: "GET", url: `/api/tasks/${firstBody.taskId}/history` });
    assert.equal(history.statusCode, 200);
    const historyBody = history.json() as { task: { attemptCount: number; correctionRounds: number; nextRequiredAction: string }; rounds: Array<{ id: string; roundNumber: number; roundType: string }> };
    assert.equal(historyBody.task.attemptCount, 2);
    assert.equal(historyBody.task.correctionRounds, 0);
    assert.equal(historyBody.rounds.length, 2);
    assert.equal(historyBody.rounds[0]?.roundType, "INITIAL");
    assert.equal(historyBody.rounds[1]?.roundType, "CONTINUATION");

    const extraProposal = await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: {
        taskId: firstBody.taskId,
        filePath: "follow-up.ts",
        operation: "CREATE",
        proposedContent: "export const followUp = true;\n",
        reason: "Add the follow-up change"
      }
    });
    assert.equal(extraProposal.statusCode, 201);
    const proposalsResponse = await app.inject({ method: "GET", url: `/api/tasks/${firstBody.taskId}/proposals` });
    assert.equal(proposalsResponse.statusCode, 200);
    const proposals = proposalsResponse.json() as { proposals: Array<{ filePath: string; taskRoundId: string | null }> };
    const followUpProposal = proposals.proposals.find((proposal) => proposal.filePath === "follow-up.ts");
    assert.equal(followUpProposal?.taskRoundId, historyBody.rounds[1]?.id ?? null);
    assert.ok(proposals.proposals.length >= 2);
    assert.equal(new Set(proposals.proposals.map((proposal) => proposal.taskRoundId)).size, 2);
  });

  it("suppresses duplicate proposals for unchanged content", async () => {
    const root = await createTestProject("project-duplicate");
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Duplicate Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };

    const chat = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, message: "Build a dashboard panel." } });
    assert.equal(chat.statusCode, 200);
    const chatBody = chat.json() as { taskId: string };

    const proposalsBefore = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    const initialCount = (proposalsBefore.json() as { proposals: unknown[] }).proposals.length;

    const proposalPayload = { taskId: chatBody.taskId, filePath: "duplicate.ts", operation: "CREATE", proposedContent: "export const duplicate = true;\n", reason: "Add duplicate helper" };
    const first = await app.inject({ method: "POST", url: "/api/proposals", payload: proposalPayload });
    assert.equal(first.statusCode, 201);
    const firstBody = first.json() as { proposal: { id: string } };

    const second = await app.inject({ method: "POST", url: "/api/proposals", payload: proposalPayload });
    assert.equal(second.statusCode, 201);
    const secondBody = second.json() as { proposal: { id: string } };
    assert.equal(secondBody.proposal.id, firstBody.proposal.id);

    const proposalsAfter = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    const finalCount = (proposalsAfter.json() as { proposals: unknown[] }).proposals.length;
    assert.equal(finalCount, initialCount + 1);
  });

  it("creates a correction round after failed checks and requires fresh approval", async () => {
    const root = await createTestProject("project-correction", { test: "node -e \"process.exit(1)\"" });
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Correction Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };

    const chat = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, message: "Build a dashboard panel and keep the repo changes recoverable." } });
    assert.equal(chat.statusCode, 200);
    const chatBody = chat.json() as { taskId: string; approvalId: string | null };

    const approval = await app.inject({ method: "POST", url: `/api/approvals/${chatBody.approvalId}/decision`, payload: { decision: "APPROVED" } });
    assert.equal(approval.statusCode, 200);

    const proposalsResponse = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    const proposals = (proposalsResponse.json() as { proposals: Array<{ id: string }> }).proposals;
    for (const proposal of proposals) {
      const approved = await app.inject({ method: "POST", url: `/api/proposals/${proposal.id}/approve`, payload: {} });
      assert.equal(approved.statusCode, 200);
    }

    const apply = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/apply` });
    assert.equal(apply.statusCode, 200);
    assert.equal((apply.json() as { status: string }).status, "FAILED_VALIDATION");

    const correction = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, taskId: chatBody.taskId, message: "Fix the failing checks and create corrective updates." } });
    assert.equal(correction.statusCode, 200);
    const correctionBody = correction.json() as { taskId: string };
    assert.equal(correctionBody.taskId, chatBody.taskId);

    const history = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/history` });
    const historyBody = history.json() as { task: { attemptCount: number; correctionRounds: number; nextRequiredAction: string }; rounds: Array<{ roundType: string }> };
    assert.equal(historyBody.task.attemptCount, 2);
    assert.equal(historyBody.task.correctionRounds, 1);
    assert.equal(historyBody.rounds[1]?.roundType, "CORRECTION");

    const correctionApply = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/apply` });
    assert.equal(correctionApply.statusCode, 409);
    assert.match((correctionApply.json() as { error: string }).error, /approved task approval/i);
  });

  it("recovers interrupted task executions safely", async () => {
    const root = await createTestProject("project-recovery");
    const register = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Recovery Project", rootPath: root } });
    assert.equal(register.statusCode, 201);
    const project = register.json() as { id: string };

    const chat = await app.inject({ method: "POST", url: "/api/chat", payload: { projectId: project.id, message: "Build a dashboard panel." } });
    assert.equal(chat.statusCode, 200);
    const chatBody = chat.json() as { taskId: string; approvalId: string | null };

    const approval = await app.inject({ method: "POST", url: `/api/approvals/${chatBody.approvalId}/decision`, payload: { decision: "APPROVED" } });
    assert.equal(approval.statusCode, 200);
    const proposalsResponse = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/proposals` });
    const proposals = (proposalsResponse.json() as { proposals: Array<{ id: string }> }).proposals;
    for (const proposal of proposals) {
      const approved = await app.inject({ method: "POST", url: `/api/proposals/${proposal.id}/approve`, payload: {} });
      assert.equal(approved.statusCode, 200);
    }

    const apply = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/apply` });
    assert.equal(apply.statusCode, 200);
    db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE task_id=?").run(chatBody.taskId);
    db.prepare("UPDATE task_executions SET status='APPLYING' WHERE task_id=?").run(chatBody.taskId);

    const historyBefore = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/history` });
    const historyBeforeBody = historyBefore.json() as { task: { recoveryAvailable: boolean } };
    assert.equal(historyBeforeBody.task.recoveryAvailable, true);

    const recover = await app.inject({ method: "POST", url: `/api/tasks/${chatBody.taskId}/recover` });
    assert.equal(recover.statusCode, 200);
    const recoverBody = recover.json() as { status: string; recoveryOutcome: string };
    assert.equal(recoverBody.status, "COMPLETED");
    assert.equal(recoverBody.recoveryOutcome, "CHECKS_PASSED");

    const historyAfter = await app.inject({ method: "GET", url: `/api/tasks/${chatBody.taskId}/history` });
    const historyAfterBody = historyAfter.json() as { task: { recoveryAvailable: boolean; recoveryStatus: string | null } };
    assert.equal(historyAfterBody.task.recoveryAvailable, false);
    assert.equal(historyAfterBody.task.recoveryStatus, "RECOVERED");
  });
});
