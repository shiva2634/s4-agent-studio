import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { initializeDatabaseOn } from "@s4/db";
import { insertProposal } from "./change-proposals.js";
import { applyTaskProposals } from "./proposal-execution.js";
import { attachSpecialistProposalOwnership, decomposeSpecialistAssignments, detectProposalConflicts, updateAssignmentLifecycle } from "./specialist-orchestration.js";
import { createTaskRound } from "./task-workflow.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function projectRoot(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `s4-specialists-${label}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node scripts/pass.cjs", test: "node scripts/pass.cjs" } }));
  await fs.writeFile(path.join(root, "scripts", "pass.cjs"), "process.exit(0);\n");
  await fs.writeFile(path.join(root, "src", "app.ts"), "export const app = 'before';\n");
  await fs.writeFile(path.join(root, "tests", "app.test.ts"), "import '../src/app';\ntest('app', () => {});\n");
  return root;
}

function dbFixture(root: string, projectStatus = "ACTIVE", taskRisk = "medium") {
  const db = new Database(":memory:");
  initializeDatabaseOn(db);
  const now = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("project-1", "Project", root, projectStatus, now, now);
  db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("task-1", "project-1", null, "developer", "Task", "Build the task", "AWAITING_APPROVAL", taskRisk, "{}", now, now);
  const round = createTaskRound(db, {
    taskId: "task-1",
    userMessage: "Build the task",
    summary: "Task",
    roundType: "INITIAL",
    status: "AWAITING_APPROVAL",
    context: {},
    approvalRequired: true,
    nextRequiredAction: "APPROVE_PROPOSALS",
    now
  });
  return { db, roundId: round.id, now };
}

const audit = () => undefined;

describe("specialist orchestration", () => {
  it("decomposes coordinator work into ordered specialist assignments and enforces dependencies", async () => {
    const root = await projectRoot("decompose");
    const { db, roundId, now } = dbFixture(root);
    try {
      const assignments = decomposeSpecialistAssignments(db, {
        taskId: "task-1",
        taskRoundId: roundId,
        projectId: "project-1",
        planSummary: "Build a UI and API change",
        planSteps: ["Plan", "Implement", "Review"],
        proposals: [
          { id: "p-front", filePath: "src/panel.tsx", operation: "CREATE", reason: "UI", taskRoundId: roundId, agentId: null },
          { id: "p-back", filePath: "src/api.ts", operation: "CREATE", reason: "API", taskRoundId: roundId, agentId: null }
        ],
        riskLevel: "medium",
        now,
        audit
      });

      assert.deepEqual(assignments.map((assignment) => assignment.role), ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "SECURITY_REVIEW", "FINAL_REVIEW"]);
      assert.equal(JSON.parse(assignments[1]?.dependencyAssignmentIdsJson ?? "[]")[0], assignments[0]?.id);
      db.prepare("UPDATE task_assignments SET status='READY' WHERE id=?").run(assignments[0]!.id);
      assert.throws(() => updateAssignmentLifecycle(db, assignments[1]!.id, "retry", now), /dependencies/i);
    } finally {
      db.close();
    }
  });

  it("preserves proposal ownership and blocks read-only or inactive specialists from mutations", async () => {
    const root = await projectRoot("ownership");
    const { db, roundId, now } = dbFixture(root);
    try {
      const proposal = await insertProposal(db, { id: "p1", taskId: "task-1", taskRoundId: roundId, projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "UPDATE", proposedContent: "export const app = 'after';\n", reason: "Backend update", now });
      decomposeSpecialistAssignments(db, {
        taskId: "task-1",
        taskRoundId: roundId,
        projectId: "project-1",
        planSummary: "Update backend",
        planSteps: ["Update"],
        proposals: [{ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, reason: proposal.reason, taskRoundId: roundId, agentId: null }],
        riskLevel: "medium",
        now,
        audit
      });
      const ownership = attachSpecialistProposalOwnership(db, { taskId: "task-1", taskRoundId: roundId, now });
      assert.equal(ownership.length, 1);
      assert.equal(ownership[0]?.role, "BACKEND");

      await assert.rejects(() => insertProposal(db, { id: "p2", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-security", projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "UPDATE", proposedContent: "export const app = 'security';\n", reason: "Read-only", now }), /Read-only specialist/);

      db.prepare("UPDATE projects SET status='PAUSED' WHERE id='project-1'").run();
      await assert.rejects(() => insertProposal(db, { id: "p3", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-backend", projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "UPDATE", proposedContent: "export const app = 'paused';\n", reason: "Paused", now }), /active registered projects/);
    } finally {
      db.close();
    }
  });

  it("detects same-file specialist conflicts and blocks apply", async () => {
    const root = await projectRoot("conflict");
    const { db, roundId, now } = dbFixture(root);
    try {
      await insertProposal(db, { id: "p1", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-backend", projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "UPDATE", proposedContent: "export const app = 'one';\n", reason: "One", now });
      await insertProposal(db, { id: "p2", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-frontend", projectId: "project-1", rootPath: root, filePath: "src/app.ts", operation: "UPDATE", proposedContent: "export const app = 'two';\n", reason: "Two", now });
      db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
      db.prepare("INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("approval-1", "task-1", roundId, "CHANGE_PROPOSAL", "Approve", "{}", "medium", "APPROVED", "2026-01-01T01:00:00.000Z", now);

      assert.equal(detectProposalConflicts(db, "task-1", roundId).length, 1);
      await assert.rejects(() => applyTaskProposals(db, "task-1", "2026-01-01T02:00:00.000Z", audit), /Conflicting specialist proposals/);
    } finally {
      db.close();
    }
  });

  it("requires fresh and high-risk approval for specialist-sensitive proposal rounds", async () => {
    const root = await projectRoot("approval");
    const { db, roundId, now } = dbFixture(root);
    try {
      await fs.writeFile(path.join(root, "schema.sql"), "select 1;\n");
      await insertProposal(db, { id: "p-db", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-database", projectId: "project-1", rootPath: root, filePath: "schema.sql", operation: "UPDATE", proposedContent: "select 2;\n", reason: "Schema", now: "2026-01-01T01:00:00.000Z" });
      db.prepare("UPDATE change_proposals SET status='APPROVED'").run();
      db.prepare("INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("approval-1", "task-1", roundId, "CHANGE_PROPOSAL", "Approve", "{}", "medium", "APPROVED", now, now);
      await assert.rejects(() => applyTaskProposals(db, "task-1", "2026-01-01T02:00:00.000Z", audit), /Fresh human approval/);

      db.prepare("UPDATE approvals SET risk_level='medium',decided_at='2026-01-01T03:00:00.000Z' WHERE id='approval-1'").run();
      await assert.rejects(() => applyTaskProposals(db, "task-1", "2026-01-01T04:00:00.000Z", audit), /High-risk human approval/);
    } finally {
      db.close();
    }
  });

  it("blocks silent test weakening and DevOps secret file proposals", async () => {
    const root = await projectRoot("testing");
    const { db, roundId, now } = dbFixture(root, "ACTIVE", "medium");
    try {
      await assert.rejects(() => insertProposal(db, { id: "p-test", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-testing", projectId: "project-1", rootPath: root, filePath: "tests/app.test.ts", operation: "UPDATE", proposedContent: "test.skip('app', () => {});\n", reason: "Skip failing test", now }), /requires explicit high-risk approval/);
      await assert.rejects(() => insertProposal(db, { id: "p-env", taskId: "task-1", taskRoundId: roundId, agentId: "specialist-devops", projectId: "project-1", rootPath: root, filePath: ".env", operation: "CREATE", proposedContent: "SECRET=x\n", reason: "Secret config", now }), /Secret files/);
    } finally {
      db.close();
    }
  });
});
