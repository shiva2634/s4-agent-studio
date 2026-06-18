import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { initializeDatabaseOn } from "@s4/db";
import { insertProposal } from "./change-proposals.js";
import { runProjectCheck } from "./command-runner.js";
import { applyTaskProposals, rollbackTask } from "./proposal-execution.js";
import { registerOrReactivateProject } from "./project-registration.js";
import { createScaffoldJob, generateScaffoldProposals } from "./scaffold-engine.js";
import { PermissionDeniedError, applyProjectPolicyProfile, assertCommandAllowed, assertFilePermission, assertNetworkAllowed, assertProviderAllowed, getProjectSecurityPolicy, listPermissionEvents, requestProjectPolicyChange, resolveProjectPolicyApproval, sanitizeForPolicy } from "./security-policy.js";

const roots: string[] = [];
const now = "2026-06-18T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function projectRoot(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `s4-policy-${label}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "console.log('ok');\n");
  await fs.writeFile(path.join(root, "scripts", "leak.cjs"), "console.error('api_key=\"sk-testsecret000000000000000000\"');\n");
  await fs.writeFile(path.join(root, "tests", "smoke.mjs"), "import assert from 'node:assert/strict';\nassert.ok(true);\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node scripts/pass.cjs", test: "node scripts/pass.cjs", build: "node scripts/pass.cjs", lint: "node scripts/pass.cjs", leak: "node scripts/leak.cjs" } }));
  await fs.writeFile(path.join(root, "existing.ts"), "export const before = true;\n");
  return root;
}

function dbFixture() {
  const db = new Database(":memory:");
  initializeDatabaseOn(db);
  return db;
}

function audit() {
  return undefined;
}

function seedTask(db: Database.Database, root: string, status = "ACTIVE") {
  db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-1", "Project", root, status, now, now);
  db.prepare(`INSERT OR IGNORE INTO project_security_policies
    (id,project_id,permission_profile_id,sandbox_enabled,network_enabled,provider_calls_enabled,secrets_blocked,command_policy_json,file_policy_json,provider_policy_json,cost_policy_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("policy-project-1", "project-1", "standard-governed", 1, 0, 1, 1, "{}", "{}", '{"adapterOnly":true}', "{}", now, now);
  db.prepare("INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("task-1", "project-1", null, "developer", "Task", "Task", "AWAITING_APPROVAL", "low", "{}", now, now);
  db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("approval-1", "task-1", "CHANGE_PROPOSAL", "Approve", "{}", "low", "APPROVED", "2026-06-18T01:00:00.000Z", now);
}

describe("sandbox and permission policy", () => {
  it("defaults registered projects to standard governed policy", async () => {
    const db = dbFixture();
    const root = await projectRoot("default");
    try {
      const project = registerOrReactivateProject(db, { id: "project-1", name: "Project", rootPath: root, now }, audit);
      const policy = getProjectSecurityPolicy(db, project.id);
      assert.equal(policy.permissionProfileId, "standard-governed");
      assert.equal(policy.sandboxEnabled, true);
      assert.equal(policy.networkEnabled, false);
      assert.equal(policy.secretsBlocked, true);
    } finally {
      db.close();
    }
  });

  it("blocks paused, archived, and deregistered projects", async () => {
    const root = await projectRoot("blocked");
    for (const status of ["PAUSED", "ARCHIVED", "DEREGISTERED"]) {
      const db = dbFixture();
      try {
        seedTask(db, root, status);
        assert.throws(() => assertFilePermission(db, { projectId: "project-1", rootPath: root, filePath: "package.json", action: "FILE_READ", now }), /blocked/);
      } finally {
        db.close();
      }
    }
  });

  it("enforces file boundaries and blocks secret paths and literal secrets", async () => {
    const db = dbFixture();
    const root = await projectRoot("files");
    try {
      seedTask(db, root);
      assert.throws(() => assertFilePermission(db, { projectId: "project-1", rootPath: root, filePath: "../escape.txt", action: "FILE_READ", now }), /traversal|outside/);
      for (const filePath of [".env", "id_rsa", "src/token.txt", "credentials.json", "node_modules/pkg/index.js", ".git/config"]) {
        assert.throws(() => assertFilePermission(db, { projectId: "project-1", rootPath: root, filePath, action: "FILE_READ", now }), /Secret|blocked/);
      }
      await assert.rejects(() => insertProposal(db, { id: "p-secret", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "CREATE", proposedContent: "const token='Bearer abcdefghijklmnopqrstuvwxyz';\n", reason: "secret", now }), /literal secret/);
    } finally {
      db.close();
    }
  });

  it("redacts secret-like output and records redaction events", async () => {
    const db = dbFixture();
    const root = await projectRoot("redact");
    try {
      seedTask(db, root);
      const redacted = sanitizeForPolicy(db, "Bearer abcdefghijklmnopqrstuvwxyz api_key=\"sk-testsecret000000000000000000\"", { projectId: "project-1", taskId: "task-1", source: "test", now });
      assert.equal(redacted.includes("abcdefghijklmnopqrstuvwxyz"), false);
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM secret_redaction_events").get() as { count: number }).count > 0);
    } finally {
      db.close();
    }
  });

  it("allows approved package scripts and blocks arbitrary, destructive, and high-risk commands", async () => {
    const db = dbFixture();
    const root = await projectRoot("commands");
    try {
      seedTask(db, root);
      const result = await runProjectCheck(root, "TEST", { db, projectId: "project-1", taskId: "task-1", now });
      assert.equal(result.ok, true);
      assert.throws(() => assertCommandAllowed(db, { projectId: "project-1", taskId: "task-1", action: "WHOAMI", script: "whoami", command: "whoami", now }), /Arbitrary shell commands/);
      assert.throws(() => assertCommandAllowed(db, { projectId: "project-1", taskId: "task-1", action: "BUILD", script: "build", command: "rm -rf .", now }), /blocked/);
      assert.throws(() => assertCommandAllowed(db, { projectId: "project-1", taskId: "task-1", action: "BUILD", script: "build", command: "npm install left-pad", now }), /require fresh human approval/);
    } finally {
      db.close();
    }
  });

  it("denies network by default, allows allowlisted hosts, and gates provider adapters", async () => {
    const db = dbFixture();
    const root = await projectRoot("network");
    try {
      seedTask(db, root);
      assert.throws(() => assertNetworkAllowed(db, { projectId: "project-1", host: "example.com", now }), /blocked/);
      db.prepare("INSERT INTO network_allowlist (id,project_id,host,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("allow-1", "project-1", "api.example.com", "test", "ACTIVE", now, now);
      assert.doesNotThrow(() => assertNetworkAllowed(db, { projectId: "project-1", host: "api.example.com", now }));
      assert.throws(() => assertProviderAllowed(db, { projectId: "project-1", provider: "nvidia", configured: false, now }), /Provider calls require/);
      assert.doesNotThrow(() => assertProviderAllowed(db, { projectId: "project-1", provider: "nvidia", configured: true, now }));
    } finally {
      db.close();
    }
  });

  it("proposal apply obeys project policy and rollback is limited to task-owned files", async () => {
    const db = dbFixture();
    const root = await projectRoot("apply");
    try {
      seedTask(db, root);
      await insertProposal(db, { id: "p1", taskId: "task-1", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export {};\n", reason: "create", now });
      db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
      db.prepare("UPDATE projects SET status='PAUSED' WHERE id='project-1'").run();
      await assert.rejects(() => applyTaskProposals(db, "task-1", "2026-06-18T02:00:00.000Z", audit), /blocked/);
      db.prepare("UPDATE projects SET status='ACTIVE' WHERE id='project-1'").run();
      await applyTaskProposals(db, "task-1", "2026-06-18T02:00:00.000Z", audit);
      await fs.writeFile(path.join(root, "manual.txt"), "keep\n");
      await rollbackTask(db, "task-1", "2026-06-18T03:00:00.000Z", audit);
      assert.equal(await fs.readFile(path.join(root, "manual.txt"), "utf8"), "keep\n");
    } finally {
      db.close();
    }
  });

  it("keeps scaffold generation under workspace policy and existing scaffold flow compatible", async () => {
    const db = dbFixture();
    const root = await projectRoot("scaffold");
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "s4-policy-workspace-"));
    roots.push(workspace);
    try {
      db.prepare("UPDATE workspace_root_config SET root_path=? WHERE id='default-local-workspace'").run(workspace);
      assert.throws(() => createScaffoldJob(db, { id: "bad", templateId: "static-landing-page", projectName: "Bad", targetDirectoryName: "../bad", mode: "CREATE_PROJECT", now, audit }), /traversal/);
      const job = createScaffoldJob(db, { id: "job-1", templateId: "static-landing-page", projectName: "Site", targetDirectoryName: "site", mode: "CREATE_PROJECT", now, audit });
      const generated = await generateScaffoldProposals(db, job.id, { now, audit });
      assert.equal(generated.files.length > 0, true);
    } finally {
      db.close();
      void root;
    }
  });

  it("requires approval for advanced and emergency policy changes and audits decisions", async () => {
    const db = dbFixture();
    const root = await projectRoot("profile");
    try {
      seedTask(db, root);
      const request = requestProjectPolicyChange(db, { id: "change-1", approvalId: "approval-policy", projectId: "project-1", profileId: "advanced-development", reason: "Need package install review", now, audit });
      assert.equal(request.approvalRequired, true);
      assert.equal(getProjectSecurityPolicy(db, "project-1").permissionProfileId, "standard-governed");
      assert.equal(resolveProjectPolicyApproval(db, "approval-policy", "APPROVED", "2026-06-18T01:00:00.000Z", audit), true);
      assert.equal(getProjectSecurityPolicy(db, "project-1").permissionProfileId, "advanced-development");
      applyProjectPolicyProfile(db, "project-1", "locked-down", "2026-06-18T02:00:00.000Z", audit);
      assert.equal(getProjectSecurityPolicy(db, "project-1").permissionProfileId, "locked-down");
      assert.ok(listPermissionEvents(db, "project-1").length > 0);
    } finally {
      db.close();
    }
  });
});
