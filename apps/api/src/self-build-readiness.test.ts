import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { initializeDatabaseOn } from "@s4/db";
import { insertProposal } from "./change-proposals.js";
import { applyTaskProposals } from "./proposal-execution.js";
import { registerOrReactivateProject } from "./project-registration.js";
import { createBuildMissionDraft, convertApprovedBuildMission, getLatestReadinessReport, listBuildMissionEvents, requestBuildMissionApproval, resolveBuildMissionApproval, runSelfBuildReadiness } from "./self-build-readiness.js";

const roots: string[] = [];
const now = "2026-06-18T00:00:00.000Z";
const audit = () => undefined;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function projectRoot(label: string, scripts: Record<string, string> = { typecheck: "node scripts/pass.cjs", test: "node scripts/pass.cjs", build: "node scripts/pass.cjs", lint: "node scripts/pass.cjs" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `s4-self-build-${label}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "console.log('ok');\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts }, null, 2));
  await fs.writeFile(path.join(root, "existing.ts"), "export const before = true;\n");
  return root;
}

function dbFixture(root: string) {
  const db = new Database(":memory:");
  initializeDatabaseOn(db);
  registerOrReactivateProject(db, { id: "project-1", name: "Project", rootPath: root, now }, audit);
  return db;
}

describe("self-build readiness validation", () => {
  it("creates all required gate results and returns READY when every gate passes", async () => {
    const root = await projectRoot("ready");
    const db = dbFixture(root);
    try {
      const report = await runSelfBuildReadiness(db, { id: "run-ready", projectId: "project-1", now, audit });
      assert.equal(report.decision, "READY");
      assert.equal(report.gates.length, 12);
      assert.deepEqual(report.gates.map((gate: any) => gate.status).filter((status: string) => status !== "PASS"), []);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM self_build_readiness_gate_results WHERE run_id='run-ready'").get() as { count: number }).count, 12);
    } finally {
      db.close();
    }
  });

  it("returns NOT_READY for blocking failures and READY_WITH_WARNINGS for warnings only", async () => {
    const root = await projectRoot("decisions");
    const db = dbFixture(root);
    try {
      db.prepare("DELETE FROM project_security_policies WHERE project_id='project-1'").run();
      const blocked = await runSelfBuildReadiness(db, { id: "run-blocked", projectId: "project-1", now, audit });
      assert.equal(blocked.decision, "NOT_READY");
      assert.ok(blocked.gates.some((gate: any) => gate.gateId === "security-policy" && gate.status === "FAIL" && gate.blocking));

      db.prepare(`INSERT INTO project_security_policies
        (id,project_id,permission_profile_id,sandbox_enabled,network_enabled,provider_calls_enabled,secrets_blocked,command_policy_json,file_policy_json,provider_policy_json,cost_policy_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("policy-restored", "project-1", "standard-governed", 1, 0, 1, 1, "{}", "{}", '{"adapterOnly":true}', "{}", now, now);
      db.prepare("UPDATE project_git_settings SET worktree_mode_enabled=0 WHERE project_id='project-1'").run();
      const warning = await runSelfBuildReadiness(db, { id: "run-warning", projectId: "project-1", now, audit });
      assert.equal(warning.decision, "READY_WITH_WARNINGS");
      assert.ok(warning.gates.some((gate: any) => gate.gateId === "git-workflow" && gate.status === "WARNING" && !gate.blocking));
    } finally {
      db.close();
    }
  });

  it("does not mutate project files and sanitizes readiness output", async () => {
    const root = await projectRoot("sanitize");
    const db = dbFixture(root);
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node scripts/pass.cjs", test: "node scripts/pass.cjs", leak: "echo Bearer abcdefghijklmnopqrstuvwxyz" } }, null, 2));
      const before = await fs.readFile(path.join(root, "package.json"), "utf8");
      const report = await runSelfBuildReadiness(db, { id: "run-sanitize", projectId: "project-1", now, audit });
      const after = await fs.readFile(path.join(root, "package.json"), "utf8");
      assert.equal(after, before);
      assert.equal(JSON.stringify(report).includes("abcdefghijklmnopqrstuvwxyz"), false);
    } finally {
      db.close();
    }
  });

  it("fails specific readiness gates when required systems are missing or unrepresentable", async () => {
    const root = await projectRoot("missing", { test: "node scripts/pass.cjs" });
    const db = dbFixture(root);
    try {
      db.prepare("DELETE FROM project_git_settings WHERE project_id='project-1'").run();
      const report = await runSelfBuildReadiness(db, { id: "run-missing", projectId: "project-1", now, audit });
      const byGate = new Map(report.gates.map((gate: any) => [gate.gateId, gate.status]));
      assert.equal(byGate.get("git-workflow"), "FAIL");
      assert.equal(byGate.get("test-typecheck"), "FAIL");
    } finally {
      db.close();
    }
  });

  it("build mission drafts are planning-only and require human approval before conversion", async () => {
    const root = await projectRoot("mission");
    const db = dbFixture(root);
    try {
      await runSelfBuildReadiness(db, { id: "run-mission", projectId: "project-1", now, audit });
      const mission = createBuildMissionDraft(db, { id: "mission-1", projectId: "project-1", targetModule: "CRM", scope: "Plan the first governed CRM module slice without generating files.", dependencies: ["Agent Core extension"], riskLevel: "high", gitMode: "WORKTREE", now, audit });
      assert.equal(mission.status, "DRAFT");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
      assert.throws(() => convertApprovedBuildMission(db, "mission-1", { now, audit }), /requires human approval/);

      const approval = requestBuildMissionApproval(db, "mission-1", { approvalId: "approval-mission", now, audit });
      assert.equal(approval.status, "AWAITING_APPROVAL");
      assert.throws(() => resolveBuildMissionApproval(db, "approval-mission", "APPROVED", now, audit, "agent"), /Agents cannot approve/);
      assert.equal(resolveBuildMissionApproval(db, "approval-mission", "APPROVED", now, audit, "human"), true);
      const converted = convertApprovedBuildMission(db, "mission-1", { gitMode: "WORKTREE", now, audit });
      assert.equal(converted.status, "CONVERTED");
      assert.equal(converted.gitMode, "WORKTREE");
      assert.ok((db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=?").get(converted.taskId) as { count: number }).count > 0);
      assert.ok(listBuildMissionEvents(db, "mission-1").length >= 3);
    } finally {
      db.close();
    }
  });

  it("NOT_READY blocks build mission conversion until readiness is fixed", async () => {
    const root = await projectRoot("blocked-mission");
    const db = dbFixture(root);
    try {
      db.prepare("DELETE FROM project_security_policies WHERE project_id='project-1'").run();
      await runSelfBuildReadiness(db, { id: "run-not-ready", projectId: "project-1", now, audit });
      const mission = createBuildMissionDraft(db, { id: "mission-blocked", projectId: "project-1", targetModule: "Social Studio", scope: "Plan a governed Social Studio slice without implementation.", riskLevel: "high", gitMode: "WORKTREE", now, audit });
      requestBuildMissionApproval(db, mission.id, { approvalId: "approval-blocked", now, audit });
      resolveBuildMissionApproval(db, "approval-blocked", "APPROVED", now, audit);
      assert.throws(() => convertApprovedBuildMission(db, mission.id, { now, audit }), /blocked until readiness/);
    } finally {
      db.close();
    }
  });

  it("preserves direct safe-apply compatibility and legacy rows through migration", async () => {
    const root = await projectRoot("compat");
    const db = dbFixture(root);
    try {
      db.prepare("INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run("task-compat", "project-1", null, "developer", "Direct apply", "Direct apply", "AWAITING_APPROVAL", "low", "{}", now, now);
      db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run("approval-compat", "task-compat", "CHANGE_PROPOSAL", "Approve", "{}", "low", "APPROVED", now, now);
      await insertProposal(db, { id: "proposal-compat", taskId: "task-compat", projectId: "project-1", rootPath: root, filePath: "created.ts", operation: "CREATE", proposedContent: "export const created = true;\n", reason: "compat", now });
      db.prepare("UPDATE change_proposals SET status='APPROVED' WHERE id='proposal-compat'").run();
      const result = await applyTaskProposals(db, "task-compat", now, audit);
      assert.equal(result.status, "COMPLETED");
      assert.match(await fs.readFile(path.join(root, "created.ts"), "utf8"), /created/);
    } finally {
      db.close();
    }

    const legacy = new Database(":memory:");
    try {
      legacy.exec("CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
      legacy.prepare("INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)").run("legacy-project", "Legacy", root, now, now);
      initializeDatabaseOn(legacy);
      assert.equal((legacy.prepare("SELECT COUNT(*) AS count FROM projects WHERE id='legacy-project'").get() as { count: number }).count, 1);
      assert.ok(legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='self_build_readiness_runs'").get());
      assert.ok(legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='build_missions'").get());
    } finally {
      legacy.close();
    }
  });
});
