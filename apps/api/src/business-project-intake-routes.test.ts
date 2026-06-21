import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-project-intake-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const [{ app }, dbModule] = await Promise.all([import("./server.js"), import("@s4/db")]);
const {
  assignBusinessRoleToUser,
  createBusinessAuthSession,
  db,
  hashBusinessSessionToken
} = dbModule;

after(async () => {
  await app.close();
  db.close();
  delete process.env.S4_DB_PATH;
  delete process.env.NODE_ENV;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

const validPayload = {
  projectName: "Client Portal Foundation",
  clientOrCompanyName: "Shrinika Technologies",
  projectType: "SaaS",
  priority: "High",
  projectSource: "Admin instruction",
  prdStatus: "Drafting",
  shortSummary: "Create the first persistent project intake.",
  problemStatement: "Business Control Centre needs stored PRD intake records.",
  targetUsers: "Admins and managers",
  coreModulesRequired: "PRD intake, review, approvals",
  keyFeatures: "Create, list, update, archive",
  integrationsNeeded: "None yet",
  designReferences: "Existing Business Control Centre",
  deliveryDeadline: "2026-07-01",
  estimatedBudgetRange: "Placeholder budget",
  risksAssumptions: "Approval workflow pending",
  finalApprovalOwner: "Manager"
};

const readyForAppStudioPayload = {
  ...validPayload,
  projectName: "Client Portal Build Mission",
  prdStatus: "Approved",
  workflowStatus: "READY_FOR_APP_STUDIO",
  coreModulesRequired: "Authentication, client dashboard, support ticket view",
  keyFeatures: "Internal approval gate, customer-safe portal shell, support visibility"
};

function cookie(rawToken: string) {
  return `shrinika_internal_session=${encodeURIComponent(rawToken)}`;
}

function createInternalSession(userId: string, rawToken: string) {
  createBusinessAuthSession(db, {
    userId,
    sessionTokenHash: hashBusinessSessionToken(rawToken),
    expiresAt: "2099-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z"
  });
  return cookie(rawToken);
}

function insertBusinessUser(input: { id: string; email: string; userType?: "INTERNAL" | "EXTERNAL_CLIENT"; status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" }) {
  db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'created','created')`).run(input.id, input.email, input.id, input.userType ?? "INTERNAL", input.status ?? "ACTIVE");
}

function insertForcedSession(input: { id: string; userId: string; rawToken: string }) {
  db.prepare(`INSERT INTO business_auth_sessions
    (id,user_id,session_token_hash,status,created_at,last_seen_at,expires_at,revoked_at,revoked_reason,ip_address_hash,user_agent_hash,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id,
    input.userId,
    hashBusinessSessionToken(input.rawToken),
    "ACTIVE",
    "created",
    "created",
    "2099-01-01T00:00:00.000Z",
    null,
    null,
    null,
    null,
    null
  );
}

function insertActiveAppStudioProject(id = "project-app-studio-handoff") {
  db.prepare(`INSERT OR IGNORE INTO projects (id,name,root_path,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(id, "S4 Agent Studio", `/tmp/${id}`, "ACTIVE", "created", "created");
}

describe("Business Control Centre project intake API", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({ method: "GET", url: "/api/business-control-centre/project-intakes" });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { authenticated: false, error: "Unauthenticated" });
  });

  it("creates, lists, gets, updates, archives, and returns events for internal users", async () => {
    const rawToken = "project-intake-owner-token";
    const sessionCookie = createInternalSession("business-user-shrinika", rawToken);

    const created = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: validPayload
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.json() as { intake: { id: string; projectName: string; createdByUserId: string; workflowStatus: string } };
    assert.equal(createdBody.intake.projectName, validPayload.projectName);
    assert.equal(createdBody.intake.createdByUserId, "business-user-shrinika");
    assert.equal(createdBody.intake.workflowStatus, "PROJECT_CREATED");
    assert.ok(!created.body.includes(rawToken));
    assert.ok(!created.body.includes("scrypt$"));

    const listed = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie }
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.json() as { intakes: unknown[] }).intakes.length, 1);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/project-intakes/${createdBody.intake.id}`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal((fetched.json() as { intake: { id: string } }).intake.id, createdBody.intake.id);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/project-intakes/${createdBody.intake.id}`,
      headers: { cookie: sessionCookie },
      payload: { prdStatus: "Under review", workflowStatus: "PRD_REVIEW" }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.json() as { intake: { prdStatus: string; workflowStatus: string } }).intake.prdStatus, "Under review");

    const events = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/project-intakes/${createdBody.intake.id}/events`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(events.statusCode, 200);
    assert.deepEqual((events.json() as { events: Array<{ eventType: string }> }).events.map((event) => event.eventType), ["PROJECT_INTAKE_CREATED", "PROJECT_INTAKE_UPDATED"]);

    const archived = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${createdBody.intake.id}/archive`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(archived.statusCode, 200);
    assert.ok((archived.json() as { intake: { archivedAt: string | null } }).intake.archivedAt);

    const afterArchive = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/project-intakes/${createdBody.intake.id}`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(afterArchive.statusCode, 404);
    const count = db.prepare("SELECT COUNT(*) AS count FROM business_project_intakes WHERE id=?").get(createdBody.intake.id) as { count: number };
    assert.equal(count.count, 1);
  });

  it("returns validation errors and forbidden responses safely", async () => {
    const ownerCookie = createInternalSession("business-user-shrinika", "project-intake-validation-token");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: ownerCookie },
      payload: { ...validPayload, projectName: "", priority: "Critical" }
    });
    assert.equal(invalid.statusCode, 400);

    insertBusinessUser({ id: "business-user-support-project-intake", email: "support-project-intake@example.local" });
    assignBusinessRoleToUser(db, { userId: "business-user-support-project-intake", roleKey: "support_manager", now: "2026-01-01T00:00:00.000Z" });
    const supportCookie = createInternalSession("business-user-support-project-intake", "project-intake-support-token");
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: supportCookie },
      payload: validPayload
    });
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { authenticated: false, error: "Forbidden" });
  });

  it("rejects external and inactive users for protected intake APIs", async () => {
    insertBusinessUser({ id: "business-user-external-intake", email: "external-intake@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-intake-session", userId: "business-user-external-intake", rawToken: "external-intake-token" });
    const external = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: cookie("external-intake-token") }
    });
    assert.equal(external.statusCode, 403);

    const suspendedToken = "suspended-intake-token";
    createInternalSession("business-user-shiva", suspendedToken);
    db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shiva'").run();
    const suspended = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: cookie(suspendedToken) }
    });
    assert.equal(suspended.statusCode, 403);
    db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shiva'").run();
  });

  it("creates a governed App Studio Build Mission draft for approved ready intakes", async () => {
    insertActiveAppStudioProject();
    const sessionCookie = createInternalSession("business-user-shrinika", "project-intake-handoff-owner-token");
    const created = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: readyForAppStudioPayload
    });
    assert.equal(created.statusCode, 201);
    const intakeId = (created.json() as { intake: { id: string } }).intake.id;

    const handoff = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(handoff.statusCode, 201);
    const body = handoff.json() as { intake: { appStudioBuildMissionId: string; workflowStatus: string }; buildMission: { id: string; status: string; approvalRequired: boolean } };
    assert.equal(body.buildMission.status, "DRAFT");
    assert.equal(body.buildMission.approvalRequired, true);
    assert.equal(body.intake.appStudioBuildMissionId, body.buildMission.id);
    assert.equal(body.intake.workflowStatus, "TEAM_ASSIGNMENT_PENDING");
    assert.ok(!handoff.body.includes("project-intake-handoff-owner-token"));
    assert.ok(!handoff.body.includes("scrypt$"));

    const missionRow = db.prepare("SELECT status,approval_id AS approvalId FROM build_missions WHERE id=?").get(body.buildMission.id) as { status: string; approvalId: string | null };
    assert.equal(missionRow.status, "DRAFT");
    assert.equal(missionRow.approvalId, null);

    const proposals = db.prepare(`SELECT COUNT(*) AS count FROM change_proposals cp
      JOIN build_missions bm ON bm.task_id=cp.task_id
      WHERE bm.id=?`).get(body.buildMission.id) as { count: number };
    assert.equal(proposals.count, 0);

    const events = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/project-intakes/${intakeId}/events`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(events.statusCode, 200);
    assert.ok((events.json() as { events: Array<{ eventType: string; metadataJson: string | null }> }).events.some((event) =>
      event.eventType === "APP_STUDIO_BUILD_MISSION_DRAFT_CREATED" && event.metadataJson?.includes(body.buildMission.id)
    ));
  });

  it("rejects ineligible and duplicate handoffs safely", async () => {
    insertActiveAppStudioProject("project-app-studio-handoff-2");
    const sessionCookie = createInternalSession("business-user-shrinika", "project-intake-handoff-validation-token");
    const draft = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: { ...readyForAppStudioPayload, projectName: "Draft PRD", prdStatus: "Drafting" }
    });
    const draftId = (draft.json() as { intake: { id: string } }).intake.id;
    const draftHandoff = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${draftId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(draftHandoff.statusCode, 400);

    const wrongWorkflow = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: { ...readyForAppStudioPayload, projectName: "Wrong Workflow", workflowStatus: "PRD_REVIEW" }
    });
    const wrongWorkflowId = (wrongWorkflow.json() as { intake: { id: string } }).intake.id;
    const wrongWorkflowHandoff = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${wrongWorkflowId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(wrongWorkflowHandoff.statusCode, 400);

    const missingContent = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: { ...readyForAppStudioPayload, projectName: "Missing Content", keyFeatures: "" }
    });
    const missingContentId = (missingContent.json() as { intake: { id: string } }).intake.id;
    const missingContentHandoff = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${missingContentId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(missingContentHandoff.statusCode, 400);

    const ready = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: sessionCookie },
      payload: { ...readyForAppStudioPayload, projectName: "Duplicate Handoff" }
    });
    const readyId = (ready.json() as { intake: { id: string } }).intake.id;
    const first = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${readyId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(first.statusCode, 201);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${readyId}/create-build-mission`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(duplicate.statusCode, 409);
    assert.ok((duplicate.json() as { buildMissionId?: string }).buildMissionId);
  });

  it("protects Build Mission handoff permission and session boundary", async () => {
    insertActiveAppStudioProject("project-app-studio-handoff-3");
    const ownerCookie = createInternalSession("business-user-shrinika", "project-intake-handoff-protect-owner-token");
    const created = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/project-intakes",
      headers: { cookie: ownerCookie },
      payload: { ...readyForAppStudioPayload, projectName: "Protected Handoff" }
    });
    const intakeId = (created.json() as { intake: { id: string } }).intake.id;

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`
    });
    assert.equal(unauthenticated.statusCode, 401);

    insertBusinessUser({ id: "business-user-support-handoff", email: "support-handoff@example.local" });
    assignBusinessRoleToUser(db, { userId: "business-user-support-handoff", roleKey: "support_manager", now: "2026-01-01T00:00:00.000Z" });
    const supportCookie = createInternalSession("business-user-support-handoff", "project-intake-handoff-support-token");
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
      headers: { cookie: supportCookie }
    });
    assert.equal(forbidden.statusCode, 403);

    insertBusinessUser({ id: "business-user-external-handoff", email: "external-handoff@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-handoff-session", userId: "business-user-external-handoff", rawToken: "external-handoff-token" });
    const external = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
      headers: { cookie: cookie("external-handoff-token") }
    });
    assert.equal(external.statusCode, 403);

    const suspendedToken = "suspended-handoff-token";
    createInternalSession("business-user-shiva", suspendedToken);
    db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shiva'").run();
    const suspended = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
      headers: { cookie: cookie(suspendedToken) }
    });
    assert.equal(suspended.statusCode, 403);
    db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shiva'").run();

    const deniedEvents = db.prepare("SELECT COUNT(*) AS count FROM denied_access_events WHERE attempted_module='app_studio' AND attempted_action='create'").get() as { count: number };
    assert.ok(deniedEvents.count >= 1);
  });
});
