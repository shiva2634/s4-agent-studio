import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import {
  createOrUpdateBuildMissionTeamAssignment,
  db,
  getBuildMissionQueueItem,
  listBuildMissionQueueItems,
  recordBuildMissionQueueEvent,
  updateBusinessProjectIntake,
  type BusinessBuildMissionTeamAssignmentInput
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";
import { getBuildMission, requestBuildMissionApproval, resolveBuildMissionApproval } from "./self-build-readiness.js";
import { sanitizeForPolicy } from "./security-policy.js";

type RequestBody = Record<string, unknown>;

export function registerBuildMissionQueueRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/build-mission-queue", withBusinessPermission("app_studio.view", async () => ({
    queue: listBuildMissionQueueItems(db)
  })));

  app.get("/api/business-control-centre/build-mission-queue/:id", withBusinessPermission("app_studio.view", async (request, reply) => {
    const item = getBuildMissionQueueItem(db, readRouteId(request.params));
    if (!item) return reply.status(404).send({ error: "Build Mission queue item not found" });
    return { item };
  }));

  app.post("/api/business-control-centre/build-mission-queue/:id/approve", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    const item = getBuildMissionQueueItem(db, buildMissionId);
    if (!item) return reply.status(404).send({ error: "Build Mission queue item not found" });
    const note = readRequiredNote(request.body, "note");
    if (!note.ok) return reply.status(400).send({ error: note.error });

    const mission = getBuildMission(db, buildMissionId);
    if (!["DRAFT", "AWAITING_APPROVAL"].includes(mission.status)) {
      return reply.status(409).send({ error: "Only draft or approval-pending Build Missions can be approved from this queue" });
    }

    const timestamp = new Date().toISOString();
    const approval = mission.approvalId
      ? { approvalId: mission.approvalId, status: mission.status }
      : requestBuildMissionApproval(db, buildMissionId, { approvalId: nanoid(), now: timestamp, audit });
    const approved = resolveBuildMissionApproval(db, approval.approvalId, "APPROVED", timestamp, audit, "human");
    if (!approved) return reply.status(409).send({ error: "Build Mission approval could not be resolved" });

    if (item.intake?.id && item.intake.workflowStatus !== "TEAM_ASSIGNMENT_PENDING") {
      updateBusinessProjectIntake(db, item.intake.id as string, { workflowStatus: "TEAM_ASSIGNMENT_PENDING" }, context.user.id, timestamp);
    }
    recordBuildMissionQueueEvent(db, {
      buildMissionId,
      eventType: "BUILD_MISSION_APPROVED_FROM_BUSINESS_QUEUE",
      actorUserId: context.user.id,
      summary: "Build Mission approved from Business Control Centre queue",
      payload: { note: note.value, approvalId: approval.approvalId },
      now: timestamp
    });
    audit("BUILD_MISSION_APPROVED_FROM_BUSINESS_QUEUE", "Build Mission approved from Business Control Centre queue", {
      projectId: mission.projectId,
      taskId: mission.taskId ?? undefined,
      payload: { buildMissionId, approvalId: approval.approvalId }
    });
    return { item: getBuildMissionQueueItem(db, buildMissionId) };
  }));

  app.post("/api/business-control-centre/build-mission-queue/:id/request-changes", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    const item = getBuildMissionQueueItem(db, buildMissionId);
    if (!item) return reply.status(404).send({ error: "Build Mission queue item not found" });
    const reason = readRequiredNote(request.body, "reason");
    if (!reason.ok) return reply.status(400).send({ error: reason.error });

    const mission = getBuildMission(db, buildMissionId);
    if (mission.status === "CONVERTED") return reply.status(409).send({ error: "Converted Build Missions cannot be returned for PRD changes" });
    const timestamp = new Date().toISOString();
    db.prepare("UPDATE build_missions SET status='CHANGES_REQUESTED',updated_at=? WHERE id=?").run(timestamp, buildMissionId);
    if (mission.taskId) db.prepare("UPDATE tasks SET status='PLANNING',updated_at=? WHERE id=?").run(timestamp, mission.taskId);
    if (mission.approvalId) {
      db.prepare("UPDATE approvals SET status='REJECTED',decision_note=?,decided_at=? WHERE id=? AND status='PENDING'")
        .run(reason.value, timestamp, mission.approvalId);
    }
    if (item.intake?.id) {
      updateBusinessProjectIntake(db, item.intake.id as string, { workflowStatus: "PRD_REVIEW" }, context.user.id, timestamp);
    }
    recordBuildMissionQueueEvent(db, {
      buildMissionId,
      eventType: "BUILD_MISSION_CHANGES_REQUESTED_FROM_BUSINESS_QUEUE",
      actorUserId: context.user.id,
      summary: "Changes requested from Business Control Centre queue",
      payload: { reason: reason.value, previousStatus: mission.status },
      now: timestamp
    });
    audit("BUILD_MISSION_CHANGES_REQUESTED_FROM_BUSINESS_QUEUE", "Changes requested from Business Control Centre queue", {
      projectId: mission.projectId,
      taskId: mission.taskId ?? undefined,
      payload: { buildMissionId }
    });
    return { item: getBuildMissionQueueItem(db, buildMissionId) };
  }));

  app.post("/api/business-control-centre/build-mission-queue/:id/assign-team", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    const item = getBuildMissionQueueItem(db, buildMissionId);
    if (!item) return reply.status(404).send({ error: "Build Mission queue item not found" });
    try {
      const timestamp = new Date().toISOString();
      const assignment = createOrUpdateBuildMissionTeamAssignment(db, {
        ...readAssignmentBody(request.body),
        buildMissionId,
        projectIntakeId: item.intake?.id as string | undefined,
        actorUserId: context.user.id,
        now: timestamp
      });
      recordBuildMissionQueueEvent(db, {
        buildMissionId,
        eventType: "BUILD_MISSION_TEAM_ASSIGNMENT_UPDATED",
        actorUserId: context.user.id,
        summary: "Build Mission team assignment updated",
        payload: { assignmentStatus: readAssignmentBody(request.body).assignmentStatus },
        now: timestamp
      });
      return { assignment, item: getBuildMissionQueueItem(db, buildMissionId) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to save Build Mission team assignment" });
    }
  }));
}

function readRouteId(params: unknown) {
  const value = params as { id?: unknown };
  return typeof value.id === "string" ? value.id : "";
}

function readBody(body: unknown): RequestBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as RequestBody;
}

function readRequiredNote(body: unknown, key: "note" | "reason") {
  const value = readBody(body)[key];
  if (typeof value !== "string" || !value.trim()) return { ok: false as const, error: `${key} is required` };
  return { ok: true as const, value: value.trim() };
}

function readString(body: RequestBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function readAssignmentBody(body: unknown): Omit<BusinessBuildMissionTeamAssignmentInput, "buildMissionId" | "projectIntakeId" | "actorUserId" | "now"> {
  const value = readBody(body);
  const status = readString(value, "assignmentStatus") ?? "DRAFT";
  return {
    managerUserId: readString(value, "managerUserId"),
    teamLeaderUserId: readString(value, "teamLeaderUserId"),
    frontendDeveloperUserId: readString(value, "frontendDeveloperUserId"),
    backendDeveloperUserId: readString(value, "backendDeveloperUserId"),
    qaUserId: readString(value, "qaUserId"),
    productionReadinessUserId: readString(value, "productionReadinessUserId"),
    supportOwnerUserId: readString(value, "supportOwnerUserId"),
    financeOwnerUserId: readString(value, "financeOwnerUserId"),
    hrOwnerUserId: readString(value, "hrOwnerUserId"),
    assignmentStatus: status as BusinessBuildMissionTeamAssignmentInput["assignmentStatus"],
    notes: readString(value, "notes")
  };
}

function audit(eventType: string, summary: string, values: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown } = {}) {
  const timestamp = new Date().toISOString();
  const cleanSummary = sanitizeForPolicy(db, summary, { projectId: values.projectId, taskId: values.taskId, source: "build-mission-queue-audit", now: timestamp });
  const cleanPayload = values.payload ? JSON.parse(sanitizeForPolicy(db, JSON.stringify(values.payload), { projectId: values.projectId, taskId: values.taskId, source: "build-mission-queue-audit-payload", now: timestamp })) as unknown : null;
  db.prepare("INSERT INTO audit_events (id,project_id,task_id,agent_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(nanoid(), values.projectId ?? null, values.taskId ?? null, values.agentId ?? null, eventType, cleanSummary, cleanPayload ? JSON.stringify(cleanPayload) : null, timestamp);
}
