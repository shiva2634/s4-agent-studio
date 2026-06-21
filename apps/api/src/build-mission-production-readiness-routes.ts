import type { FastifyInstance } from "fastify";
import {
  approveBuildMissionProductionReadiness,
  archiveBuildMissionProductionReadiness,
  createBuildMissionProductionReadinessChecklist,
  db,
  getBuildMissionProductionReadinessDashboardItem,
  getBuildMissionQueueItem,
  listBuildMissionProductionReadinessDashboardItems,
  rejectBuildMissionProductionReadiness,
  updateBuildMissionProductionReadinessItem,
  updateBuildMissionProductionReadinessStatus
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type RequestBody = Record<string, unknown>;

export function registerBuildMissionProductionReadinessRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/build-mission-production-readiness", withBusinessPermission("app_studio.view", async () => ({
    dashboard: listBuildMissionProductionReadinessDashboardItems(db)
  })));

  app.get("/api/business-control-centre/build-mission-production-readiness/:id", withBusinessPermission("app_studio.view", async (request, reply) => {
    const item = getBuildMissionProductionReadinessDashboardItem(db, readRouteId(request.params));
    if (!item) return reply.status(404).send({ error: "Production readiness dashboard item not found" });
    return { item };
  }));

  app.post("/api/business-control-centre/build-mission-production-readiness/:id/create", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return reply.status(201).send({
        item: createBuildMissionProductionReadinessChecklist(db, {
          buildMissionId,
          actorUserId: context.user.id,
          readinessOwnerUserId: readOptionalString(readBody(request.body), "readinessOwnerUserId"),
          now: new Date().toISOString()
        })
      });
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to create production readiness checklist" });
    }
  }));

  app.patch("/api/business-control-centre/build-mission-production-readiness/:id/status", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const body = readBody(request.body);
    const readinessStatus = readRequiredString(body, "readinessStatus");
    if (!readinessStatus.ok) return reply.status(400).send({ error: readinessStatus.error });
    try {
      return {
        item: updateBuildMissionProductionReadinessStatus(db, {
          buildMissionId,
          actorUserId: context.user.id,
          readinessStatus: readinessStatus.value as Parameters<typeof updateBuildMissionProductionReadinessStatus>[1]["readinessStatus"],
          note: readOptionalString(body, "note"),
          readinessOwnerUserId: readOptionalString(body, "readinessOwnerUserId"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to update production readiness checklist status" });
    }
  }));

  app.patch("/api/business-control-centre/build-mission-production-readiness/:id/items/:itemId", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    const itemId = readItemRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const body = readBody(request.body);
    const itemStatus = readRequiredString(body, "itemStatus");
    if (!itemStatus.ok) return reply.status(400).send({ error: itemStatus.error });
    try {
      return {
        item: updateBuildMissionProductionReadinessItem(db, {
          buildMissionId,
          itemId,
          actorUserId: context.user.id,
          itemStatus: itemStatus.value as Parameters<typeof updateBuildMissionProductionReadinessItem>[1]["itemStatus"],
          severity: readOptionalString(body, "severity") as Parameters<typeof updateBuildMissionProductionReadinessItem>[1]["severity"],
          evidenceNote: readOptionalString(body, "evidenceNote"),
          blockerReason: readOptionalString(body, "blockerReason"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to update production readiness checklist item" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-production-readiness/:id/approve", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return {
        item: approveBuildMissionProductionReadiness(db, {
          buildMissionId,
          actorUserId: context.user.id,
          note: readOptionalString(readBody(request.body), "note"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to approve production readiness checklist" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-production-readiness/:id/reject", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const reason = readRequiredString(readBody(request.body), "reason");
    if (!reason.ok) return reply.status(400).send({ error: reason.error });
    try {
      return {
        item: rejectBuildMissionProductionReadiness(db, {
          buildMissionId,
          actorUserId: context.user.id,
          reason: reason.value,
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to reject production readiness checklist" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-production-readiness/:id/archive", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return {
        item: archiveBuildMissionProductionReadiness(db, {
          buildMissionId,
          actorUserId: context.user.id,
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to archive production readiness checklist" });
    }
  }));
}

function readRouteId(params: unknown) {
  const value = params as { id?: unknown };
  return typeof value.id === "string" ? value.id : "";
}

function readItemRouteId(params: unknown) {
  const value = params as { itemId?: unknown };
  return typeof value.itemId === "string" ? value.itemId : "";
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
