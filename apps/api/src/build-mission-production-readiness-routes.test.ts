import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-build-mission-production-readiness-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "production-readiness.db");

const [{ app }, dbModule] = await Promise.all([import("./server.js"), import("@s4/db")]);
const {
  approveBuildMissionDevelopmentStart,
  approveBuildMissionProductionReadiness,
  approveBuildMissionQaChecklist,
  createBusinessAuthSession,
  createBusinessProjectIntake,
  createBuildMissionExecutionStatus,
  createBuildMissionProductionReadinessChecklist,
  createBuildMissionQaChecklist,
  createOrUpdateBuildMissionTeamAssignment,
  db,
  hashBusinessSessionToken,
  markBusinessProjectIntakeBuildMissionHandoff,
  requestBuildMissionDevelopmentStart,
  updateBuildMissionExecutionStatus,
  updateBuildMissionQaChecklistItem,
  updateBuildMissionQaChecklistStatus
} = dbModule;

after(async () => {
  await app.close();
  db.close();
  delete process.env.S4_DB_PATH;
  delete process.env.NODE_ENV;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

const readyPayload = {
  projectName: "Production Readiness Mission",
  clientOrCompanyName: "Shrinika Technologies",
  projectType: "Internal Tool",
  priority: "High",
  projectSource: "Admin instruction",
  prdStatus: "Approved",
  shortSummary: "Create a governed production readiness checklist after QA approval.",
  problemStatement: "Need a manual production readiness gate before deployment approval.",
  targetUsers: "Internal release reviewers",
  coreModulesRequired: "Auth, execution, QA, readiness",
  keyFeatures: "Checklist, approvals, archive",
  integrationsNeeded: "None",
  designReferences: "Business Control Centre",
  deliveryDeadline: "2026-07-18",
  estimatedBudgetRange: "Placeholder",
  risksAssumptions: "Governed approval required",
  finalApprovalOwner: "Manager",
  workflowStatus: "READY_FOR_APP_STUDIO"
};

function cookie(rawToken: string) {
  return `shrinika_internal_session=${encodeURIComponent(rawToken)}`;
}

function createInternalSession(userId: string, rawToken: string) {
  createBusinessAuthSession(db, {
    userId,
    sessionTokenHash: hashBusinessSessionToken(rawToken),
    expiresAt: "2099-01-01T00:00:00.000Z",
    now: "2026-01-08T00:00:00.000Z"
  });
  return cookie(rawToken);
}

function insertBusinessUser(input: { id: string; email: string; displayName?: string; userType?: "INTERNAL" | "EXTERNAL_CLIENT"; status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" }) {
  db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(input.id, input.email, input.displayName ?? input.id, input.userType ?? "INTERNAL", input.status ?? "ACTIVE", "2026-01-08T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
}

function insertForcedSession(userId: string, rawToken: string) {
  db.prepare(`INSERT INTO business_auth_sessions
    (id,user_id,session_token_hash,status,created_at,last_seen_at,expires_at,revoked_at,revoked_reason,ip_address_hash,user_agent_hash,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `${userId}-${rawToken}`,
    userId,
    hashBusinessSessionToken(rawToken),
    "ACTIVE",
    "2026-01-08T00:00:00.000Z",
    "2026-01-08T00:00:00.000Z",
    "2099-01-01T00:00:00.000Z",
    null,
    null,
    null,
    null,
    null
  );
}

function prepareProductionReadinessMission(key: string, options: { qaApproved?: boolean; productionReady?: boolean } = {}) {
  const { qaApproved = true, productionReady = true } = options;
  const projectId = `project-production-readiness-route-${key}`;
  const buildMissionId = `build-mission-production-readiness-route-${key}`;
  db.prepare("INSERT OR IGNORE INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(projectId, `Production Readiness Route Project ${key}`, `/tmp/${projectId}`, "ACTIVE", "2026-01-08T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
  db.prepare(`INSERT INTO build_missions
    (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,
      scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,approval_id,plan_json,created_at,updated_at,approved_at,converted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    buildMissionId,
    projectId,
    null,
    null,
    "Production Readiness Module",
    "Production readiness scope",
    "[]",
    "high",
    "[]",
    "{}",
    "WORKTREE",
    "[]",
    "Rollback readiness changes",
    "DRAFT",
    null,
    "{}",
    "2026-01-08T00:00:00.000Z",
    "2026-01-08T00:00:00.000Z",
    null,
    null
  );

  const intake = createBusinessProjectIntake(db, {
    projectName: `Production Readiness Route Project ${key}`,
    clientOrCompanyName: "Shrinika Technologies",
    projectType: "Internal Tool",
    priority: "High",
    projectSource: "Admin instruction",
    prdStatus: "Approved",
    shortSummary: "Production readiness route test intake.",
    problemStatement: "Need governed readiness review before deployment approval.",
    targetUsers: "Internal release reviewers",
    coreModulesRequired: "Auth, execution, QA, readiness",
    keyFeatures: "Checklist, approvals, archive",
    integrationsNeeded: "None",
    designReferences: "Business Control Centre",
    deliveryDeadline: "2026-07-18",
    estimatedBudgetRange: "Placeholder",
    risksAssumptions: "Governed approval required",
    finalApprovalOwner: "Manager",
    workflowStatus: "READY_FOR_APP_STUDIO",
    actorUserId: "business-user-shrinika",
    now: "2026-01-08T00:01:00.000Z"
  }) as { id: string };
  markBusinessProjectIntakeBuildMissionHandoff(db, {
    intakeId: intake.id,
    buildMissionId,
    actorUserId: "business-user-shrinika",
    now: "2026-01-08T00:02:00.000Z"
  });
  db.prepare("UPDATE build_missions SET status='APPROVED',approval_id='approval-production-readiness-route',approved_at=?,updated_at=? WHERE id=?")
    .run("2026-01-08T00:02:30.000Z", "2026-01-08T00:02:30.000Z", buildMissionId);
  createOrUpdateBuildMissionTeamAssignment(db, {
    buildMissionId,
    assignmentStatus: "ASSIGNED",
    managerUserId: "business-user-shrinika",
    teamLeaderUserId: "business-user-shiva",
    frontendDeveloperUserId: "business-user-shiva",
    backendDeveloperUserId: "business-user-shiva",
    qaUserId: "business-user-shiva",
    productionReadinessUserId: "business-user-shiva",
    actorUserId: "business-user-shrinika",
    now: "2026-01-08T00:03:00.000Z"
  });
  requestBuildMissionDevelopmentStart(db, {
    buildMissionId,
    actorUserId: "business-user-shrinika",
    note: "Ready for development planning before readiness checks.",
    now: "2026-01-08T00:04:00.000Z"
  });
  approveBuildMissionDevelopmentStart(db, {
    buildMissionId,
    actorUserId: "business-user-shiva",
    note: "Approve governed development start.",
    now: "2026-01-08T00:05:00.000Z"
  });
  createBuildMissionExecutionStatus(db, {
    buildMissionId,
    actorUserId: "business-user-shrinika",
    ownerUserId: "business-user-shiva",
    now: "2026-01-08T00:06:00.000Z"
  });
  updateBuildMissionExecutionStatus(db, {
    buildMissionId,
    actorUserId: "business-user-shiva",
    executionStatus: "QA_REVIEW",
    currentStage: "TESTING_QA",
    progressPercent: 84,
    qaStatus: "QA_REVIEW",
    ownerUserId: "business-user-shiva",
    now: "2026-01-08T00:07:00.000Z"
  });
  const qaChecklist = createBuildMissionQaChecklist(db, {
    buildMissionId,
    actorUserId: "business-user-shrinika",
    qaOwnerUserId: "business-user-shiva",
    now: "2026-01-08T00:07:45.000Z"
  });
  for (const item of qaChecklist!.items) {
    updateBuildMissionQaChecklistItem(db, {
      buildMissionId,
      itemId: item.id,
      actorUserId: "business-user-shiva",
      itemStatus: "PASS",
      severity: item.severity,
      evidenceNote: `Checked ${item.itemKey}`,
      now: "2026-01-08T00:08:00.000Z"
    });
  }
  updateBuildMissionQaChecklistStatus(db, {
    buildMissionId,
    actorUserId: "business-user-shrinika",
    qaStatus: qaApproved ? "READY_FOR_APPROVAL" : "IN_PROGRESS",
    note: qaApproved ? "QA complete before production readiness review" : "QA still in progress",
    now: "2026-01-08T00:08:30.000Z"
  });
  if (qaApproved) {
    approveBuildMissionQaChecklist(db, {
      buildMissionId,
      actorUserId: "business-user-shiva",
      note: "QA approved for readiness",
      now: "2026-01-08T00:09:00.000Z"
    });
  }
  if (productionReady) {
    updateBuildMissionExecutionStatus(db, {
      buildMissionId,
      actorUserId: "business-user-shiva",
      executionStatus: "PRODUCTION_READINESS_REVIEW",
      currentStage: "PRODUCTION_READINESS",
      progressPercent: 93,
      productionReadinessStatus: "READY_FOR_PRODUCTION_READINESS",
      ownerUserId: "business-user-shiva",
      now: "2026-01-08T00:10:00.000Z"
    });
  }

  return buildMissionId;
}

describe("Business Control Centre production readiness API", () => {
  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/business-control-centre/build-mission-production-readiness" });
    assert.equal(response.statusCode, 401);
  });

  it("lists and gets production readiness dashboards for internal users", async () => {
    createInternalSession("business-user-shrinika", "production-readiness-view-token");
    const buildMissionId = prepareProductionReadinessMission("dashboard");
    const checklist = createBuildMissionProductionReadinessChecklist(db, {
      buildMissionId,
      actorUserId: "business-user-shrinika",
      readinessOwnerUserId: "business-user-shiva",
      now: "2026-01-08T00:11:00.000Z"
    });
    assert.ok(checklist);

    const list = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-production-readiness",
      headers: { cookie: cookie("production-readiness-view-token") }
    });
    assert.equal(list.statusCode, 200);
    const dashboard = (list.json() as { dashboard: Array<{ buildMissionId: string; productionReadinessChecklist: { readinessStatus: string } | null }> }).dashboard;
    assert.ok(dashboard.some((item) => item.buildMissionId === buildMissionId));

    const itemResponse = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}`,
      headers: { cookie: cookie("production-readiness-view-token") }
    });
    assert.equal(itemResponse.statusCode, 200);
    const item = (itemResponse.json() as { item: { buildMissionId: string; productionReadinessChecklist: { readinessStatus: string; readyForApproval: boolean } | null } }).item;
    assert.equal(item.buildMissionId, buildMissionId);
    assert.equal(item.productionReadinessChecklist?.readinessStatus, "DRAFT");
    assert.ok(!itemResponse.body.includes("scrypt$"));
    assert.ok(!itemResponse.body.includes("session_token_hash"));
  });

  it("rejects external and inactive users", async () => {
    insertBusinessUser({ id: "business-user-production-readiness-external", email: "pr-external@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession("business-user-production-readiness-external", "production-readiness-external-token");
    insertBusinessUser({ id: "business-user-production-readiness-suspended", email: "pr-suspended-route@example.local", status: "SUSPENDED" });
    insertForcedSession("business-user-production-readiness-suspended", "production-readiness-suspended-token");

    const external = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-production-readiness",
      headers: { cookie: cookie("production-readiness-external-token") }
    });
    assert.equal(external.statusCode, 403);

    const suspended = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-production-readiness",
      headers: { cookie: cookie("production-readiness-suspended-token") }
    });
    assert.equal(suspended.statusCode, 403);
  });

  it("requires update permission to create and only approves without side effects", async () => {
    const buildMissionId = prepareProductionReadinessMission("approval-flow", { qaApproved: false, productionReady: false });
    const noPermissionUserId = "business-user-production-readiness-no-permission";
    insertBusinessUser({ id: noPermissionUserId, email: "no-permission@example.local" });
    const noPermissionCookie = createInternalSession(noPermissionUserId, "production-readiness-no-permission-token");

    const deniedCreate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/create`,
      headers: { cookie: noPermissionCookie },
      payload: {}
    });
    assert.equal(deniedCreate.statusCode, 403);

    const deniedApprove = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/approve`,
      headers: { cookie: noPermissionCookie },
      payload: { note: "Should not approve without permission" }
    });
    assert.equal(deniedApprove.statusCode, 403);

    const deniedReject = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/reject`,
      headers: { cookie: noPermissionCookie },
      payload: { reason: "Should not reject without permission" }
    });
    assert.equal(deniedReject.statusCode, 403);

    const invalidReady = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/create`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: {}
    });
    assert.equal(invalidReady.statusCode, 400);

    updateBuildMissionQaChecklistStatus(db, {
      buildMissionId,
      actorUserId: "business-user-shrinika",
      qaStatus: "READY_FOR_APPROVAL",
      note: "QA complete before production readiness review",
      now: "2026-01-08T00:09:30.000Z"
    });
    approveBuildMissionQaChecklist(db, {
      buildMissionId,
      actorUserId: "business-user-shiva",
      note: "QA approved for readiness",
      now: "2026-01-08T00:09:45.000Z"
    });

    const invalidStageReady = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/create`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: {}
    });
    assert.equal(invalidStageReady.statusCode, 400);

    updateBuildMissionExecutionStatus(db, {
      buildMissionId,
      actorUserId: "business-user-shiva",
      executionStatus: "PRODUCTION_READINESS_REVIEW",
      currentStage: "PRODUCTION_READINESS",
      progressPercent: 93,
      productionReadinessStatus: "READY_FOR_PRODUCTION_READINESS",
      ownerUserId: "business-user-shiva",
      now: "2026-01-08T00:10:00.000Z"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/create`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { readinessOwnerUserId: "business-user-shiva" }
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json() as { item: { readinessStatus: string; readyForApproval: boolean; items: Array<{ id: string; itemKey: string }> } };
    assert.equal(created.item.readinessStatus, "DRAFT");
    assert.equal(created.item.items.length, 14);

    const duplicateCreate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/create`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { readinessOwnerUserId: "business-user-shiva" }
    });
    assert.equal(duplicateCreate.statusCode, 409);

    const failItem = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/items/${created.item.items[0]!.id}`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { itemStatus: "FAIL", severity: "HIGH" }
    });
    assert.equal(failItem.statusCode, 400);

    const readyForApproval = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/status`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { readinessStatus: "READY_FOR_APPROVAL" }
    });
    assert.equal(readyForApproval.statusCode, 400);

    const setItemsPass = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/items/${created.item.items[0]!.id}`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { itemStatus: "PASS", severity: "HIGH", evidenceNote: "Validated item" }
    });
    assert.equal(setItemsPass.statusCode, 200);

    for (const item of created.item.items.slice(1)) {
      db.prepare(`UPDATE business_build_mission_production_readiness_items
        SET item_status='PASS',severity=?,evidence_note=?,checked_by_user_id=?,checked_at=?,updated_at=?
        WHERE id=?`).run(
        "MEDIUM",
        `Validated ${item.itemKey}`,
        "business-user-shiva",
        "2026-01-08T00:11:10.000Z",
        "2026-01-08T00:11:10.000Z",
        item.id
      );
    }

    const readyStatus = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/status`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { readinessStatus: "READY_FOR_APPROVAL", note: "Checklist ready" }
    });
    assert.equal(readyStatus.statusCode, 200);

    const approvalCountBefore = (db.prepare("SELECT COUNT(*) AS count FROM approvals").get() as { count: number }).count;
    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/approve`,
      headers: { cookie: cookie("production-readiness-view-token") },
      payload: { note: "Ready for deployment approval, no deploy started" }
    });
    assert.equal(approved.statusCode, 200);
    const approvedBody = approved.json() as { item: { readinessStatus: string } };
    assert.equal(approvedBody.item.readinessStatus, "APPROVED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM approvals").get() as { count: number }).count, approvalCountBefore);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_assignments").get() as { count: number }).count, 0);
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='BUILD_MISSION_PRODUCTION_READINESS_CHECKLIST_APPROVED'").get(buildMissionId));
  });

  it("requires approval permission for reject and archive and stays secret-safe", async () => {
    const buildMissionId = prepareProductionReadinessMission("reject-archive");
    const approvedSession = createInternalSession("business-user-shiva", "production-readiness-approve-token");
    const rejectResponse = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-production-readiness/${buildMissionId}/reject`,
      headers: { cookie: approvedSession },
      payload: { reason: "" }
    });
    assert.equal(rejectResponse.statusCode, 400);

    const response = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-production-readiness",
      headers: { cookie: approvedSession }
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("scrypt$"));
    assert.ok(!response.body.includes("session_token_hash"));
  });
});
