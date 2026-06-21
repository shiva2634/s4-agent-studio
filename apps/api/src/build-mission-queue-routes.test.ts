import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-build-mission-queue-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "queue.db");

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

const readyPayload = {
  projectName: "Queue Client Portal",
  clientOrCompanyName: "Shrinika Technologies",
  projectType: "SaaS",
  priority: "High",
  projectSource: "Admin instruction",
  prdStatus: "Approved",
  shortSummary: "Create a queue-ready build mission.",
  problemStatement: "Approved PRD needs review and assignment.",
  targetUsers: "Internal team",
  coreModulesRequired: "Auth, dashboard, support",
  keyFeatures: "Login, ticket visibility, approval gate",
  integrationsNeeded: "None",
  designReferences: "Business Control Centre",
  deliveryDeadline: "2026-07-01",
  estimatedBudgetRange: "Placeholder",
  risksAssumptions: "Approval gates required",
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

function insertActiveAppStudioProject(id: string) {
  db.prepare("INSERT OR IGNORE INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, "S4 Agent Studio", `/tmp/${id}`, "ACTIVE", "created", "created");
}

async function createQueueMission(sessionCookie: string, projectName: string) {
  insertActiveAppStudioProject(`project-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  const created = await app.inject({
    method: "POST",
    url: "/api/business-control-centre/project-intakes",
    headers: { cookie: sessionCookie },
    payload: { ...readyPayload, projectName }
  });
  assert.equal(created.statusCode, 201);
  const intakeId = (created.json() as { intake: { id: string } }).intake.id;
  const handoff = await app.inject({
    method: "POST",
    url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
    headers: { cookie: sessionCookie }
  });
  assert.equal(handoff.statusCode, 201);
  return (handoff.json() as { intake: { id: string }; buildMission: { id: string } });
}

describe("Business Control Centre Build Mission queue API", () => {
  it("rejects unauthenticated queue access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/business-control-centre/build-mission-queue" });
    assert.equal(response.statusCode, 401);
  });

  it("lists and gets linked Build Mission queue items for internal users", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-owner-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Listing Mission");

    const list = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-queue",
      headers: { cookie: sessionCookie }
    });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json() as { queue: Array<{ buildMissionId: string }> }).queue.some((item) => item.buildMissionId === handoff.buildMission.id));

    const get = await app.inject({
      method: "GET",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(get.statusCode, 200);
    const item = (get.json() as { item: { buildMissionId: string; intake: { id: string } } }).item;
    assert.equal(item.buildMissionId, handoff.buildMission.id);
    assert.equal(item.intake.id, handoff.intake.id);
    assert.ok(!get.body.includes("queue-owner-token"));
    assert.ok(!get.body.includes("scrypt$"));
  });

  it("approves a draft without running agents or creating proposals", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-approve-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Approval Mission");

    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Manager approves this draft for assignment." }
    });
    assert.equal(approved.statusCode, 200);
    const item = (approved.json() as { item: { status: string; intake: { workflowStatus: string } } }).item;
    assert.equal(item.status, "APPROVED");
    assert.equal(item.intake.workflowStatus, "TEAM_ASSIGNMENT_PENDING");

    const mission = db.prepare("SELECT task_id AS taskId,status FROM build_missions WHERE id=?").get(handoff.buildMission.id) as { taskId: string; status: string };
    assert.equal(mission.status, "APPROVED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='BUILD_MISSION_APPROVED_FROM_BUSINESS_QUEUE'").get(handoff.buildMission.id));
  });

  it("requests changes with a reason and moves linked intake back to PRD review", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-changes-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Changes Mission");

    const missingReason = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-changes`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(missingReason.statusCode, 400);

    const response = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-changes`,
      headers: { cookie: sessionCookie },
      payload: { reason: "Core modules need more detail before assignment." }
    });
    assert.equal(response.statusCode, 200);
    const item = (response.json() as { item: { status: string; intake: { workflowStatus: string } } }).item;
    assert.equal(item.status, "CHANGES_REQUESTED");
    assert.equal(item.intake.workflowStatus, "PRD_REVIEW");
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='BUILD_MISSION_CHANGES_REQUESTED_FROM_BUSINESS_QUEUE'").get(handoff.buildMission.id));
  });

  it("saves assignment drafts, finalizes only with manager, and updates duplicates", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-assignment-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Assignment Mission");

    const draft = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: {
        assignmentStatus: "DRAFT",
        teamLeaderUserId: "Team Leader Placeholder",
        qaUserId: "Developer 3",
        productionReadinessUserId: "Developer 3",
        notes: "Short-staffed coverage draft"
      }
    });
    assert.equal(draft.statusCode, 200);
    const draftBody = draft.json() as { assignment: { id: string; assignmentStatus: string; notes: string } };
    assert.equal(draftBody.assignment.assignmentStatus, "DRAFT");
    assert.ok(draftBody.assignment.notes.includes("Warning: QA and production readiness"));

    const invalidFinalize = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "ASSIGNED" }
    });
    assert.equal(invalidFinalize.statusCode, 400);

    const assigned = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: {
        assignmentStatus: "ASSIGNED",
        managerUserId: "Manager Placeholder",
        frontendDeveloperUserId: "Developer 1",
        backendDeveloperUserId: "Developer 2",
        qaUserId: "Developer 3",
        productionReadinessUserId: "Developer 4",
        notes: "Finalized internal assignment."
      }
    });
    assert.equal(assigned.statusCode, 200);
    const assignedBody = assigned.json() as { assignment: { id: string; assignmentStatus: string; managerUserId: string } };
    assert.equal(assignedBody.assignment.id, draftBody.assignment.id);
    assert.equal(assignedBody.assignment.assignmentStatus, "ASSIGNED");
    assert.equal(assignedBody.assignment.managerUserId, "Manager Placeholder");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM business_build_mission_team_assignments WHERE build_mission_id=?").get(handoff.buildMission.id) as { count: number }).count, 1);
  });

  it("enforces permissions and internal-only session boundaries", async () => {
    const ownerCookie = createInternalSession("business-user-shrinika", "queue-boundary-owner-token");
    const handoff = await createQueueMission(ownerCookie, "Queue Boundary Mission");

    insertBusinessUser({ id: "business-user-support-queue", email: "support-queue@example.local" });
    assignBusinessRoleToUser(db, { userId: "business-user-support-queue", roleKey: "support_manager", now: "2026-01-01T00:00:00.000Z" });
    const supportCookie = createInternalSession("business-user-support-queue", "queue-support-token");
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: supportCookie },
      payload: { note: "Should not approve." }
    });
    assert.equal(forbidden.statusCode, 403);

    insertBusinessUser({ id: "business-user-external-queue", email: "external-queue@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-queue-session", userId: "business-user-external-queue", rawToken: "external-queue-token" });
    const external = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-queue",
      headers: { cookie: cookie("external-queue-token") }
    });
    assert.equal(external.statusCode, 403);

    const suspendedToken = "queue-suspended-token";
    createInternalSession("business-user-shiva", suspendedToken);
    db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shiva'").run();
    const suspended = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-queue",
      headers: { cookie: cookie(suspendedToken) }
    });
    assert.equal(suspended.statusCode, 403);
    db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shiva'").run();

    const deniedEvents = db.prepare("SELECT COUNT(*) AS count FROM denied_access_events WHERE attempted_module IN ('app_studio','auth')").get() as { count: number };
    assert.ok(deniedEvents.count >= 1);
  });
});
