import type { FastifyInstance } from "fastify";
import {
  createBuildMissionQaChecklist,
  db,
  getBuildMissionQaDashboardItem,
  getBuildMissionQueueItem,
  listBuildMissionQaDashboardItems,
  updateBuildMissionQaChecklistItem,
  updateBuildMissionQaChecklistStatus,
  approveBuildMissionQaChecklist,
  rejectBuildMissionQaChecklist,
  archiveBuildMissionQaChecklist
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type RequestBody = Record<string, unknown>;

export function registerBuildMissionQaRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/build-mission-qa", withBusinessPermission("app_studio.view", async () => ({
    dashboard: listBuildMissionQaDashboardItems(db)
  })));

  app.get("/api/business-control-centre/build-mission-qa/:id", withBusinessPermission("app_studio.view", async (request, reply) => {
    const item = getBuildMissionQaDashboardItem(db, readRouteId(request.params));
    if (!item) return reply.status(404).send({ error: "QA dashboard item not found" });
    return { item };
  }));

  app.post("/api/business-control-centre/build-mission-qa/:id/create", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return reply.status(201).send({
        item: createBuildMissionQaChecklist(db, {
          buildMissionId,
          actorUserId: context.user.id,
          qaOwnerUserId: readOptionalString(readBody(request.body), "qaOwnerUserId"),
          now: new Date().toISOString()
        })
      });
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to create QA checklist" });
    }
  }));

  app.patch("/api/business-control-centre/build-mission-qa/:id/status", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const body = readBody(request.body);
    const qaStatus = readRequiredString(body, "qaStatus");
    if (!qaStatus.ok) return reply.status(400).send({ error: qaStatus.error });
    try {
      return {
        item: updateBuildMissionQaChecklistStatus(db, {
          buildMissionId,
          actorUserId: context.user.id,
          qaStatus: qaStatus.value as Parameters<typeof updateBuildMissionQaChecklistStatus>[1]["qaStatus"],
          note: readOptionalString(body, "note"),
          qaOwnerUserId: readOptionalString(body, "qaOwnerUserId"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to update QA checklist status" });
    }
  }));

  app.patch("/api/business-control-centre/build-mission-qa/:id/items/:itemId", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    const itemId = readItemRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const body = readBody(request.body);
    const itemStatus = readRequiredString(body, "itemStatus");
    if (!itemStatus.ok) return reply.status(400).send({ error: itemStatus.error });
    try {
      return {
        item: updateBuildMissionQaChecklistItem(db, {
          buildMissionId,
          itemId,
          actorUserId: context.user.id,
          itemStatus: itemStatus.value as Parameters<typeof updateBuildMissionQaChecklistItem>[1]["itemStatus"],
          severity: readOptionalString(body, "severity") as Parameters<typeof updateBuildMissionQaChecklistItem>[1]["severity"],
          evidenceNote: readOptionalString(body, "evidenceNote"),
          blockerReason: readOptionalString(body, "blockerReason"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to update QA checklist item" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-qa/:id/approve", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return {
        item: approveBuildMissionQaChecklist(db, {
          buildMissionId,
          actorUserId: context.user.id,
          note: readOptionalString(readBody(request.body), "note"),
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to approve QA checklist" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-qa/:id/reject", withBusinessPermission("app_studio.approve", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    const reason = readRequiredString(readBody(request.body), "reason");
    if (!reason.ok) return reply.status(400).send({ error: reason.error });
    try {
      return {
        item: rejectBuildMissionQaChecklist(db, {
          buildMissionId,
          actorUserId: context.user.id,
          reason: reason.value,
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to reject QA checklist" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-qa/:id/archive", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      return {
        item: archiveBuildMissionQaChecklist(db, {
          buildMissionId,
          actorUserId: context.user.id,
          now: new Date().toISOString()
        })
      };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to archive QA checklist" });
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
