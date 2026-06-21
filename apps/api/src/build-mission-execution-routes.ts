import type { FastifyInstance } from "fastify";
import {
  archiveBuildMissionExecutionStatus,
  createBuildMissionExecutionStatus,
  db,
  getBuildMissionExecutionDashboardItem,
  getBuildMissionQueueItem,
  listBuildMissionExecutionDashboardItems,
  updateBuildMissionExecutionStatus,
  type BuildMissionExecutionStatusInput
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type RequestBody = Record<string, unknown>;

export function registerBuildMissionExecutionRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/build-mission-execution-dashboard", withBusinessPermission("app_studio.view", async () => ({
    dashboard: listBuildMissionExecutionDashboardItems(db)
  })));

  app.get("/api/business-control-centre/build-mission-execution-dashboard/:id", withBusinessPermission("app_studio.view", async (request, reply) => {
    const item = getBuildMissionExecutionDashboardItem(db, readRouteId(request.params));
    if (!item) return reply.status(404).send({ error: "Build Mission execution dashboard item not found" });
    return { item };
  }));

  app.post("/api/business-control-centre/build-mission-execution-dashboard/:id/create", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      createBuildMissionExecutionStatus(db, {
        ...readExecutionBody(request.body),
        buildMissionId,
        actorUserId: context.user.id,
        now: new Date().toISOString()
      });
      return reply.status(201).send({ item: getBuildMissionExecutionDashboardItem(db, buildMissionId) });
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to create Build Mission execution record" });
    }
  }));

  app.patch("/api/business-control-centre/build-mission-execution-dashboard/:id", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      updateBuildMissionExecutionStatus(db, {
        ...readExecutionBody(request.body),
        buildMissionId,
        actorUserId: context.user.id,
        now: new Date().toISOString()
      });
      return { item: getBuildMissionExecutionDashboardItem(db, buildMissionId) };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to update Build Mission execution record" });
    }
  }));

  app.post("/api/business-control-centre/build-mission-execution-dashboard/:id/archive", withBusinessPermission("projects.update", async (request, reply, context) => {
    const buildMissionId = readRouteId(request.params);
    if (!getBuildMissionQueueItem(db, buildMissionId)) return reply.status(404).send({ error: "Build Mission not found" });
    try {
      archiveBuildMissionExecutionStatus(db, {
        buildMissionId,
        actorUserId: context.user.id,
        now: new Date().toISOString()
      });
      return { item: getBuildMissionQueueItem(db, buildMissionId) };
    } catch (error) {
      return reply.status(errorStatus(error)).send({ error: error instanceof Error ? error.message : "Unable to archive Build Mission execution record" });
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
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(body: RequestBody, key: string) {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

function readExecutionBody(body: unknown): Omit<BuildMissionExecutionStatusInput, "buildMissionId" | "actorUserId" | "now"> {
  const value = readBody(body);
  return {
    executionStatus: readOptionalString(value, "executionStatus") as BuildMissionExecutionStatusInput["executionStatus"],
    currentStage: readOptionalString(value, "currentStage") as BuildMissionExecutionStatusInput["currentStage"],
    progressPercent: readOptionalNumber(value, "progressPercent"),
    frontendStatus: readOptionalString(value, "frontendStatus"),
    backendStatus: readOptionalString(value, "backendStatus"),
    qaStatus: readOptionalString(value, "qaStatus"),
    productionReadinessStatus: readOptionalString(value, "productionReadinessStatus"),
    blockerSummary: readOptionalString(value, "blockerSummary"),
    nextAction: readOptionalString(value, "nextAction"),
    ownerUserId: readOptionalString(value, "ownerUserId")
  };
}

function errorStatus(error: unknown): 400 | 409 {
  if (error instanceof Error && (
    error.message.includes("already exists") ||
    error.message.includes("not found")
  )) return 409;
  return 400;
}
