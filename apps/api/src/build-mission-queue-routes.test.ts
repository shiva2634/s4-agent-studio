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

const socialAutomationPayload = {
  projectName: "Social Automation Studio \u2014 Phase 1 MVP Shell",
  clientOrCompanyName: "Shrinika Technologies",
  projectType: "Mobile App",
  priority: "High",
  projectSource: "Admin instruction",
  prdStatus: "Approved",
  shortSummary: "Create the Phase 1 MVP shell for Social Automation Studio.",
  problemStatement: "Shrinika needs a governed social automation foundation with approvals and empty states only.",
  targetUsers: "Android customers, internal operators, approvers, support, finance, compliance, and admins.",
  coreModulesRequired: "Android customer app shell, internal website dashboard shell, CRM starter, finance and credits starter, content idea intake, editing and compliance queue, publishing approval queue, Meta Ads intake, third-party advertisement marketplace intake, support ticket starter, analytics starter",
  keyFeatures: "OpenAI script and prompt workflow placeholder, AI generation job queue placeholder, real empty states only, internal and customer separation, no live platform calls, no payment automation",
  integrationsNeeded: "OpenAI API, Meta Ads intake only, analytics backend, support backend, future billing provider, mobile app shell, future iOS roadmap",
  designReferences: "Follow existing Business Control Centre and App Studio governed workflow patterns.",
  deliveryDeadline: null,
  estimatedBudgetRange: null,
  risksAssumptions: "No unauthorized scraping, no copyrighted movie clips or music, no celebrity cloning, no live external platform API calls, no payment automation, and human approval remains required for publishing and high-cost actions.",
  finalApprovalOwner: "Shrinika",
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

async function createSocialAutomationQueueMission(sessionCookie: string) {
  insertActiveAppStudioProject("project-social-automation-studio-phase-1-mvp-shell");
  const created = await app.inject({
    method: "POST",
    url: "/api/business-control-centre/project-intakes",
    headers: { cookie: sessionCookie },
    payload: socialAutomationPayload
  });
  assert.equal(created.statusCode, 201);
  const intakeId = (created.json() as { intake: { id: string } }).intake.id;
  const handoff = await app.inject({
    method: "POST",
    url: `/api/business-control-centre/project-intakes/${intakeId}/create-build-mission`,
    headers: { cookie: sessionCookie }
  });
  assert.equal(handoff.statusCode, 201);
  return handoff.json() as { intake: { id: string; workflowStatus: string }; buildMission: { id: string; targetModule: string; approvalRequired: boolean } };
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

  it("lists safe assignable internal users only", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-assignable-token");
    insertBusinessUser({ id: "business-user-assignable-external", email: "assignable-external@example.local", userType: "EXTERNAL_CLIENT" });
    insertBusinessUser({ id: "business-user-assignable-suspended", email: "assignable-suspended@example.local", status: "SUSPENDED" });

    const unauthenticated = await app.inject({ method: "GET", url: "/api/business-control-centre/assignable-users" });
    assert.equal(unauthenticated.statusCode, 401);

    const response = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/assignable-users",
      headers: { cookie: sessionCookie }
    });
    assert.equal(response.statusCode, 200);
    const users = (response.json() as { users: Array<{ id: string; email: string; roleKeys: string[]; passwordHash?: string; sessionTokenHash?: string }> }).users;
    assert.ok(users.some(user => user.id === "business-user-shrinika" && user.roleKeys.includes("main_admin_owner")));
    assert.ok(users.some(user => user.id === "business-user-shiva" && user.roleKeys.includes("system_guardian")));
    assert.ok(!users.some(user => user.id === "business-user-assignable-external"));
    assert.ok(!users.some(user => user.id === "business-user-assignable-suspended"));
    assert.ok(!response.body.includes("scrypt$"));
    assert.ok(!response.body.includes("session_token_hash"));
    assert.ok(!response.body.includes("passwordHash"));

    insertBusinessUser({ id: "business-user-external-assignable-route", email: "external-assignable-route@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-assignable-route-session", userId: "business-user-external-assignable-route", rawToken: "external-assignable-route-token" });
    const external = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/assignable-users",
      headers: { cookie: cookie("external-assignable-route-token") }
    });
    assert.equal(external.statusCode, 403);
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
        teamLeaderUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        notes: "Short-staffed coverage draft"
      }
    });
    assert.equal(draft.statusCode, 200);
    const draftBody = draft.json() as { assignment: { id: string; assignmentStatus: string; notes: string }; assignmentWarnings: string[] };
    assert.equal(draftBody.assignment.assignmentStatus, "DRAFT");
    assert.ok(draftBody.assignment.notes.includes("Short-staffing warning"));
    assert.ok(draftBody.assignmentWarnings.some(warning => warning.includes("Short-staffing warning")));

    const invalidFinalize = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "ASSIGNED" }
    });
    assert.equal(invalidFinalize.statusCode, 400);

    const unknownUser = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "DRAFT", frontendDeveloperUserId: "missing-user" }
    });
    assert.equal(unknownUser.statusCode, 400);
    assert.match((unknownUser.json() as { error: string }).error, /Frontend Developer user not found/);

    insertBusinessUser({ id: "business-user-external-assignment-api", email: "external-assignment-api@example.local", userType: "EXTERNAL_CLIENT" });
    const externalAssignment = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "DRAFT", frontendDeveloperUserId: "business-user-external-assignment-api" }
    });
    assert.equal(externalAssignment.statusCode, 400);
    assert.match((externalAssignment.json() as { error: string }).error, /Frontend Developer must be an internal user/);

    insertBusinessUser({ id: "business-user-inactive-assignment-api", email: "inactive-assignment-api@example.local", status: "SUSPENDED" });
    const inactiveAssignment = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "DRAFT", frontendDeveloperUserId: "business-user-inactive-assignment-api" }
    });
    assert.equal(inactiveAssignment.statusCode, 400);
    assert.match((inactiveAssignment.json() as { error: string }).error, /Frontend Developer must be an active internal user/);

    const assigned = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: {
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        frontendDeveloperUserId: "business-user-shiva",
        backendDeveloperUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        notes: "Finalized internal assignment."
      }
    });
    assert.equal(assigned.statusCode, 200);
    const assignedBody = assigned.json() as { assignment: { id: string; assignmentStatus: string; managerUserId: string } };
    assert.equal(assignedBody.assignment.id, draftBody.assignment.id);
    assert.equal(assignedBody.assignment.assignmentStatus, "ASSIGNED");
    assert.equal(assignedBody.assignment.managerUserId, "business-user-shrinika");
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

  it("requests and approves development start without running agents or creating proposals", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-dev-start-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Development Start Mission");
    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve before development-start gate." }
    });
    assert.equal(approved.statusCode, 200);
    const assignment = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "ASSIGNED", managerUserId: "business-user-shrinika", qaUserId: "business-user-shiva", productionReadinessUserId: "business-user-shiva" }
    });
    assert.equal(assignment.statusCode, 200);

    const requested = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Ready for development planning. token=do-not-store" }
    });
    assert.equal(requested.statusCode, 200);
    const requestedItem = (requested.json() as { item: { developmentGate: { gateStatus: string; requestNote: string | null } } }).item;
    assert.equal(requestedItem.developmentGate.gateStatus, "REQUESTED");
    assert.ok(!String(requestedItem.developmentGate.requestNote).includes("do-not-store"));

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Duplicate request" }
    });
    assert.equal(duplicate.statusCode, 409);

    const devApproved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approved for development planning only." }
    });
    assert.equal(devApproved.statusCode, 200);
    const approvedItem = (devApproved.json() as { item: { developmentGate: { gateStatus: string }; assignment: { assignmentStatus: string } } }).item;
    assert.equal(approvedItem.developmentGate.gateStatus, "APPROVED");
    assert.equal(approvedItem.assignment.assignmentStatus, "READY_FOR_DEVELOPMENT_APPROVAL");

    const mission = db.prepare("SELECT task_id AS taskId,status FROM build_missions WHERE id=?").get(handoff.buildMission.id) as { taskId: string; status: string };
    assert.equal(mission.status, "APPROVED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='DEVELOPMENT_START_REQUESTED'").get(handoff.buildMission.id));
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='DEVELOPMENT_START_APPROVED'").get(handoff.buildMission.id));
  });

  it("moves the Social Automation Studio Phase 1 MVP Shell through approval, assignment, and development-start request", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-social-automation-token");
    const handoff = await createSocialAutomationQueueMission(sessionCookie);
    assert.equal(handoff.buildMission.targetModule, "Social Studio");
    assert.equal(handoff.buildMission.approvalRequired, true);
    assert.equal(handoff.intake.workflowStatus, "TEAM_ASSIGNMENT_PENDING");

    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve the Social Automation Studio build mission draft." }
    });
    assert.equal(approved.statusCode, 200);
    const approvedItem = approved.json() as { item: { status: string; intake: { workflowStatus: string } } };
    assert.equal(approvedItem.item.status, "APPROVED");
    assert.equal(approvedItem.item.intake.workflowStatus, "TEAM_ASSIGNMENT_PENDING");

    const assigned = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: {
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        frontendDeveloperUserId: "business-user-shiva",
        backendDeveloperUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        notes: "Assign the governed internal team."
      }
    });
    assert.equal(assigned.statusCode, 200);
    const assignedItem = assigned.json() as { assignment: { assignmentStatus: string; managerUserId: string } };
    assert.equal(assignedItem.assignment.assignmentStatus, "ASSIGNED");
    assert.equal(assignedItem.assignment.managerUserId, "business-user-shrinika");

    const requested = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Request development-start approval for Social Automation Studio." }
    });
    assert.equal(requested.statusCode, 200);
    const requestedItem = requested.json() as { item: { developmentGate: { gateStatus: string } } };
    assert.equal(requestedItem.item.developmentGate.gateStatus, "REQUESTED");

    const noExecutionYet = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: { ownerUserId: "business-user-shiva" }
    });
    assert.equal(noExecutionYet.statusCode, 400);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals cp JOIN build_missions bm ON bm.task_id=cp.task_id WHERE bm.id=?").get(handoff.buildMission.id) as { count: number }).count, 0);
  });

  it("rejects invalid development-start requests and blocks requested starts with a reason", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-dev-block-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Development Block Mission");

    const notApproved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Too early" }
    });
    assert.equal(notApproved.statusCode, 400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve for gate validation." }
    });
    assert.equal(approved.statusCode, 200);
    const missingAssignment = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Still no assignment" }
    });
    assert.equal(missingAssignment.statusCode, 400);
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "ASSIGNED", managerUserId: "business-user-shrinika" }
    });
    const requested = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Request to block later" }
    });
    assert.equal(requested.statusCode, 200);
    const missingReason = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/block-development-start`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(missingReason.statusCode, 400);
    const blocked = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/block-development-start`,
      headers: { cookie: sessionCookie },
      payload: { reason: "Testing plan missing." }
    });
    assert.equal(blocked.statusCode, 200);
    const blockedItem = (blocked.json() as { item: { developmentGate: { gateStatus: string; blockReason: string } } }).item;
    assert.equal(blockedItem.developmentGate.gateStatus, "BLOCKED");
    assert.equal(blockedItem.developmentGate.blockReason, "Testing plan missing.");
    assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id=? AND event_type='DEVELOPMENT_START_BLOCKED'").get(handoff.buildMission.id));
  });

  it("protects development-start endpoints with internal permissions", async () => {
    const ownerCookie = createInternalSession("business-user-shrinika", "queue-dev-permission-owner-token");
    const handoff = await createQueueMission(ownerCookie, "Queue Development Permission Mission");
    insertBusinessUser({ id: "business-user-support-dev-start", email: "support-dev-start@example.local" });
    assignBusinessRoleToUser(db, { userId: "business-user-support-dev-start", roleKey: "support_manager", now: "2026-01-01T00:00:00.000Z" });
    const supportCookie = createInternalSession("business-user-support-dev-start", "queue-dev-support-token");
    const forbiddenRequest = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: supportCookie },
      payload: { note: "No permission" }
    });
    assert.equal(forbiddenRequest.statusCode, 403);

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve-development-start`,
      payload: { note: "No session" }
    });
    assert.equal(unauthenticated.statusCode, 401);

    insertBusinessUser({ id: "business-user-external-dev-start", email: "external-dev-start@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-dev-start-session", userId: "business-user-external-dev-start", rawToken: "external-dev-start-token" });
    const external = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/block-development-start`,
      headers: { cookie: cookie("external-dev-start-token") },
      payload: { reason: "External rejected" }
    });
    assert.equal(external.statusCode, 403);
  });

  it("protects and manages Build Mission execution dashboard records after all gates", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-execution-token");
    const handoff = await createQueueMission(sessionCookie, "Queue Execution Dashboard Mission");

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-execution-dashboard"
    });
    assert.equal(unauthenticated.statusCode, 401);

    const tooEarly = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(tooEarly.statusCode, 400);

    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve before execution dashboard." }
    });
    const noAssignment = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(noAssignment.statusCode, 400);

    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: { assignmentStatus: "ASSIGNED", managerUserId: "business-user-shrinika", qaUserId: "business-user-shiva", productionReadinessUserId: "business-user-shiva" }
    });
    const noGate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(noGate.statusCode, 400);

    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Ready for execution dashboard tracking." }
    });
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve visibility only." }
    });

    const listReady = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-execution-dashboard",
      headers: { cookie: sessionCookie }
    });
    assert.equal(listReady.statusCode, 200);
    assert.ok((listReady.json() as { dashboard: Array<{ buildMissionId: string; executionStatus: unknown }> }).dashboard.some(item => item.buildMissionId === handoff.buildMission.id && item.executionStatus === null));

    const created = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: { ownerUserId: "business-user-shiva" }
    });
    assert.equal(created.statusCode, 201);
    const createdItem = (created.json() as { item: { executionStatus: { executionStatus: string; currentStage: string; ownerUserId: string } } }).item;
    assert.equal(createdItem.executionStatus.executionStatus, "READY_TO_START");
    assert.equal(createdItem.executionStatus.currentStage, "DEVELOPMENT_START_APPROVED");
    assert.equal(createdItem.executionStatus.ownerUserId, "business-user-shiva");
    assert.ok(!created.body.includes("scrypt$"));
    assert.ok(!created.body.includes("session_token_hash"));

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(duplicate.statusCode, 409);

    const invalidProgress = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}`,
      headers: { cookie: sessionCookie },
      payload: { executionStatus: "IN_PROGRESS", currentStage: "FRONTEND_BUILD", progressPercent: 101 }
    });
    assert.equal(invalidProgress.statusCode, 400);

    const missingBlocker = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}`,
      headers: { cookie: sessionCookie },
      payload: { executionStatus: "BLOCKED", currentStage: "INTEGRATION", progressPercent: 40 }
    });
    assert.equal(missingBlocker.statusCode, 400);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}`,
      headers: { cookie: sessionCookie },
      payload: {
        executionStatus: "BLOCKED",
        currentStage: "INTEGRATION",
        progressPercent: 40,
        blockerSummary: "Integration contract pending",
        nextAction: "Manager review required",
        ownerUserId: "business-user-shrinika"
      }
    });
    assert.equal(updated.statusCode, 200);
    const updatedItem = (updated.json() as { item: { executionStatus: { executionStatus: string; blockerSummary: string; progressPercent: number } } }).item;
    assert.equal(updatedItem.executionStatus.executionStatus, "BLOCKED");
    assert.equal(updatedItem.executionStatus.blockerSummary, "Integration contract pending");
    assert.equal(updatedItem.executionStatus.progressPercent, 40);

    const archive = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/archive`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(archive.statusCode, 200);
    const archivedItem = (archive.json() as { item: { executionStatus: unknown } }).item;
    assert.equal(archivedItem.executionStatus, null);

    const mission = db.prepare("SELECT task_id AS taskId,status FROM build_missions WHERE id=?").get(handoff.buildMission.id) as { taskId: string; status: string };
    assert.equal(mission.status, "APPROVED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=?").get(mission.taskId) as { count: number }).count, 0);
  });

  it("creates and governs QA checklists without starting agents or deploying", async () => {
    const sessionCookie = createInternalSession("business-user-shrinika", "queue-qa-token");
    const limitedUserId = "business-user-qa-limited";
    insertBusinessUser({ id: limitedUserId, email: "qa-limited@example.local" });
    insertForcedSession({ id: "forced-qa-limited-session", userId: limitedUserId, rawToken: "qa-limited-token" });
    insertBusinessUser({ id: "business-user-qa-external", email: "qa-external@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-qa-external-session", userId: "business-user-qa-external", rawToken: "qa-external-token" });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-qa"
    });
    assert.equal(unauthenticated.statusCode, 401);

    const external = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-qa",
      headers: { cookie: cookie("qa-external-token") }
    });
    assert.equal(external.statusCode, 403);

    const inactiveUserId = "business-user-qa-inactive";
    insertBusinessUser({ id: inactiveUserId, email: "qa-inactive@example.local", status: "SUSPENDED" });
    insertForcedSession({ id: "forced-qa-inactive-session", userId: inactiveUserId, rawToken: "qa-inactive-token" });
    const inactive = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-qa",
      headers: { cookie: cookie("qa-inactive-token") }
    });
    assert.equal(inactive.statusCode, 403);

    const handoff = await createQueueMission(sessionCookie, "Queue QA Mission");
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve for QA testing" }
    });
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/assign-team`,
      headers: { cookie: sessionCookie },
      payload: {
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva"
      }
    });
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/request-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Ready for QA approval flow." }
    });
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-queue/${handoff.buildMission.id}/approve-development-start`,
      headers: { cookie: sessionCookie },
      payload: { note: "Approve QA-ready development gate." }
    });
    await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: { ownerUserId: "business-user-shiva" }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-execution-dashboard/${handoff.buildMission.id}`,
      headers: { cookie: sessionCookie },
      payload: { executionStatus: "QA_REVIEW", currentStage: "TESTING_QA", progressPercent: 85, qaStatus: "QA_REVIEW" }
    });

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/build-mission-qa",
      headers: { cookie: sessionCookie }
    });
    assert.equal(dashboard.statusCode, 200);
    assert.ok((dashboard.json() as { dashboard: Array<{ buildMissionId: string }> }).dashboard.some((item) => item.buildMissionId === handoff.buildMission.id));

    const createBlockedByPermission = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/create`,
      headers: { cookie: cookie("qa-limited-token") },
      payload: { qaOwnerUserId: "business-user-shiva" }
    });
    assert.equal(createBlockedByPermission.statusCode, 403);

    const create = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/create`,
      headers: { cookie: sessionCookie },
      payload: { qaOwnerUserId: "business-user-shiva" }
    });
    assert.equal(create.statusCode, 201);
    const createdItem = (create.json() as { item: { qaStatus: string; items: Array<{ id: string; itemKey: string; itemStatus: string }> } }).item;
    assert.equal(createdItem.qaStatus, "DRAFT");
    assert.equal(createdItem.items.length, 10);
    assert.ok(!create.body.includes("scrypt$"));
    assert.ok(!create.body.includes("session_token_hash"));

    const itemId = createdItem.items[0]?.id;
    assert.ok(itemId);
    const invalidItemUpdate = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/items/${itemId}`,
      headers: { cookie: sessionCookie },
      payload: { itemStatus: "FAIL", severity: "HIGH" }
    });
    assert.equal(invalidItemUpdate.statusCode, 400);

    const readyTooEarly = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/status`,
      headers: { cookie: sessionCookie },
      payload: { qaStatus: "READY_FOR_APPROVAL" }
    });
    assert.equal(readyTooEarly.statusCode, 400);

    for (const item of createdItem.items) {
      const update = await app.inject({
        method: "PATCH",
        url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/items/${item.id}`,
        headers: { cookie: sessionCookie },
        payload: {
          itemStatus: "PASS",
          severity: "HIGH",
          evidenceNote: `Checked ${item.itemKey}`
        }
      });
      assert.equal(update.statusCode, 200);
    }

    const limitedApprove = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/approve`,
      headers: { cookie: cookie("qa-limited-token") },
      payload: { note: "No approval permission" }
    });
    assert.equal(limitedApprove.statusCode, 403);

    const ready = await app.inject({
      method: "PATCH",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/status`,
      headers: { cookie: sessionCookie },
      payload: { qaStatus: "READY_FOR_APPROVAL", note: "QA items complete" }
    });
    assert.equal(ready.statusCode, 200);

    const rejectMissingReason = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/reject`,
      headers: { cookie: sessionCookie },
      payload: {}
    });
    assert.equal(rejectMissingReason.statusCode, 400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/approve`,
      headers: { cookie: sessionCookie },
      payload: { note: "QA approved without deploy" }
    });
    assert.equal(approved.statusCode, 200);
    assert.ok(!approved.body.includes("scrypt$"));
    assert.ok(!approved.body.includes("session_token_hash"));
    const approvedBody = approved.json() as { item: { qaStatus: string } };
    assert.equal(approvedBody.item.qaStatus, "APPROVED");
    assert.equal((db.prepare("SELECT qa_status AS qaStatus FROM business_build_mission_execution_statuses WHERE build_mission_id=?").get(handoff.buildMission.id) as { qaStatus: string }).qaStatus, "QA_APPROVED");

    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_assignments").get() as { count: number }).count, 0);

    const archive = await app.inject({
      method: "POST",
      url: `/api/business-control-centre/build-mission-qa/${handoff.buildMission.id}/archive`,
      headers: { cookie: sessionCookie }
    });
    assert.equal(archive.statusCode, 200);
    const archivedBody = archive.json() as { item: { qaStatus: string; archivedAt: string | null } };
    assert.equal(archivedBody.item.qaStatus, "ARCHIVED");
    assert.ok(archivedBody.item.archivedAt);
  });
});
