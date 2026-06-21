import type { FastifyInstance } from "fastify";
import {
  approveBuildMissionDeploymentApproval,
  archiveBuildMissionDeploymentApproval,
  createBuildMissionDeploymentApproval,
  db,
  getBuildMissionDeploymentApprovalDashboardItem,
  getBuildMissionQueueItem,
  listBuildMissionDeploymentApprovalDashboardItems,
  rejectBuildMissionDeploymentApproval
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type RequestBody = Record<string, unknown>;

export function registerBuildMissionDeploymentApprovalRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/build-mission-deployment-approvals", withBusinessPermission("app_studio.view", async () => ({
    dashboard: listBuildMissionDeploymentApprovalDashboardItems(db)
  })));

  app.get("/api/business-control-centre/build-mission-deployment-approvals/:id", withBusinessPermission("app_studio.view", async (request, reply) => {
    const item = getBuildMissionDeploymentApprovalDashboardItem(db, readRouteId(request.params));
    if (!item) return reply.status(404).send({ error: "Deployment approval dashboard item not found" });
    return { item };
  }));

  app.post("/api/business-control-centre/build-mission-deployment-approvals/:id/create", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      createBuildMissionDeploymentApproval(db, {
        buildMissionId,
        actorUserId: context.user.id,
        note: readOptionalString(readBody(request.body), "note"),
        now: new Date().toISOString()
      });
      return reply.status(201).send({
        item: getBuildMissionDeploymentApprovalDashboardItem(db, buildMissionId)
      });
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to create deployment approval" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-deployment-approvals/:id/approve", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      approveBuildMissionDeploymentApproval(db, {
        buildMissionId,
        actorUserId: context.user.id,
        note: readOptionalString(readBody(request.body), "note"),
        now: new Date().toISOString()
      });
      return {
        item: getBuildMissionDeploymentApprovalDashboardItem(db, buildMissionId)
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to approve deployment approval" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-deployment-approvals/:id/reject", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const reason = readRequiredString(readBody(request.body), "reason");
    if (!reason.ok) return reply.status(400).send({ error: reason.error });
    try {
      rejectBuildMissionDeploymentApproval(db, {
        buildMissionId,
        actorUserId: context.user.id,
        reason: reason.value,
        now: new Date().toISOString()
      });
      return {
        item: getBuildMissionDeploymentApprovalDashboardItem(db, buildMissionId)
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to reject deployment approval" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-deployment-approvals/:id/archive", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      const archivedApproval = archiveBuildMissionDeploymentApproval(db, {
        buildMissionId,
        actorUserId: context.user.id,
        now: new Date().toISOString()
      });
      const item = getBuildMissionDeploymentApprovalDashboardItem(db, buildMissionId);
      return {
        item: item ? { ...item, deploymentApproval: archivedApproval } : archivedApproval
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to archive deployment approval" });
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

function readOptionalString(body: RequestBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function readRequiredString(body: RequestBody, key: string) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) return { ok: false as const, error: `${key} is required` };
  return { ok: true as const, value: value.trim() };
}

function errorStatus(error: unknown): 400 | 404 | 409 {
  if (error instanceof Error && error.message.includes("already exists")) return 409;
  if (error instanceof Error && error.message.includes("not found")) return 404;
  return 400;
}
