import type { FastifyInstance } from "fastify";
import {
  archiveBusinessProjectIntake,
  createBusinessProjectIntake,
  db,
  getBusinessProjectIntakeById,
  listBusinessProjectIntakes,
  listBusinessProjectPrdEvents,
  updateBusinessProjectIntake,
  type BusinessProjectIntakeFilters,
  type BusinessProjectIntakeInput,
  type BusinessProjectIntakePatch
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type ProjectIntakeBody = Record<string, unknown>;

export function registerBusinessProjectIntakeRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/project-intakes", withBusinessPermission("projects.view", async (request) => ({
    intakes: listBusinessProjectIntakes(db, parseFilters((request as { query?: Record<string, unknown> }).query ?? {}))
  })));

  app.post("/api/business-control-centre/project-intakes", withBusinessPermission("projects.create", async (request, reply, context) => {
    try {
      const intake = createBusinessProjectIntake(db, {
        ...readProjectIntakeBody(request.body),
        actorUserId: context.user.id
      });
      return reply.status(201).send({ intake });
    } catch (error) {
      return reply.status(400).send({ error: safeErrorMessage(error, "Unable to create project intake") });
    }
  }));

  app.get("/api/business-control-centre/project-intakes/:id", withBusinessPermission("projects.view", async (request, reply) => {
    const id = readRouteId(request.params);
    const intake = getBusinessProjectIntakeById(db, id);
    if (!intake) return reply.status(404).send({ error: "Project intake not found" });
    return { intake };
  }));

  app.patch("/api/business-control-centre/project-intakes/:id", withBusinessPermission("projects.update", async (request, reply, context) => {
    try {
      const intake = updateBusinessProjectIntake(db, readRouteId(request.params), readProjectIntakePatch(request.body), context.user.id);
      if (!intake) return reply.status(404).send({ error: "Project intake not found" });
      return { intake };
    } catch (error) {
      return routeError(reply, error, "Unable to update project intake");
    }
  }));

  app.post("/api/business-control-centre/project-intakes/:id/archive", withBusinessPermission("projects.update", async (request, reply, context) => {
    try {
      const intake = archiveBusinessProjectIntake(db, readRouteId(request.params), context.user.id);
      if (!intake) return reply.status(404).send({ error: "Project intake not found" });
      return { intake };
    } catch (error) {
      return routeError(reply, error, "Unable to archive project intake");
    }
  }));

  app.get("/api/business-control-centre/project-intakes/:id/events", withBusinessPermission("projects.view", async (request, reply) => {
    try {
      return { events: listBusinessProjectPrdEvents(db, readRouteId(request.params)) };
    } catch {
      return reply.status(404).send({ error: "Project intake not found" });
    }
  }));
}

function parseFilters(query: Record<string, unknown>): BusinessProjectIntakeFilters {
  const filters: BusinessProjectIntakeFilters = {};
  if (query.includeArchived === "true") filters.includeArchived = true;
  if (typeof query.prdStatus === "string") filters.prdStatus = query.prdStatus as BusinessProjectIntakeFilters["prdStatus"];
  if (typeof query.priority === "string") filters.priority = query.priority as BusinessProjectIntakeFilters["priority"];
  if (typeof query.workflowStatus === "string") filters.workflowStatus = query.workflowStatus as BusinessProjectIntakeFilters["workflowStatus"];
  return filters;
}

function readProjectIntakeBody(body: unknown): Omit<BusinessProjectIntakeInput, "actorUserId"> {
  const value = readObjectBody(body);
  return {
    projectName: readString(value, "projectName"),
    clientOrCompanyName: readString(value, "clientOrCompanyName"),
    projectType: readString(value, "projectType") as BusinessProjectIntakeInput["projectType"],
    priority: readString(value, "priority") as BusinessProjectIntakeInput["priority"],
    projectSource: readString(value, "projectSource") as BusinessProjectIntakeInput["projectSource"],
    prdStatus: readString(value, "prdStatus") as BusinessProjectIntakeInput["prdStatus"],
    shortSummary: readString(value, "shortSummary"),
    problemStatement: readString(value, "problemStatement"),
    targetUsers: readOptionalString(value, "targetUsers"),
    coreModulesRequired: readOptionalString(value, "coreModulesRequired"),
    keyFeatures: readOptionalString(value, "keyFeatures"),
    integrationsNeeded: readOptionalString(value, "integrationsNeeded"),
    designReferences: readOptionalString(value, "designReferences"),
    deliveryDeadline: readOptionalString(value, "deliveryDeadline"),
    estimatedBudgetRange: readOptionalString(value, "estimatedBudgetRange"),
    risksAssumptions: readOptionalString(value, "risksAssumptions"),
    finalApprovalOwner: readString(value, "finalApprovalOwner") as BusinessProjectIntakeInput["finalApprovalOwner"],
    workflowStatus: readOptionalString(value, "workflowStatus") as BusinessProjectIntakeInput["workflowStatus"]
  };
}

function readProjectIntakePatch(body: unknown): BusinessProjectIntakePatch {
  const value = readObjectBody(body);
  const patch: Record<string, unknown> = {};
  for (const key of [
    "projectName",
    "clientOrCompanyName",
    "projectType",
    "priority",
    "projectSource",
    "prdStatus",
    "shortSummary",
    "problemStatement",
    "targetUsers",
    "coreModulesRequired",
    "keyFeatures",
    "integrationsNeeded",
    "designReferences",
    "deliveryDeadline",
    "estimatedBudgetRange",
    "risksAssumptions",
    "finalApprovalOwner",
    "workflowStatus"
  ]) {
    if (key in value) patch[key] = typeof value[key] === "string" ? value[key] : null;
  }
  return patch as BusinessProjectIntakePatch;
}

function readObjectBody(body: unknown): ProjectIntakeBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request body");
  return body as ProjectIntakeBody;
}

function readString(body: ProjectIntakeBody, key: string) {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`${key} is required`);
  return value;
}

function readOptionalString(body: ProjectIntakeBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function readRouteId(params: unknown) {
  const value = params as { id?: unknown };
  return typeof value.id === "string" ? value.id : "";
}

function routeError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown, fallback: string) {
  const message = safeErrorMessage(error, fallback);
  return reply.status(message === "Project intake not found" ? 404 : 400).send({ error: message });
}

function safeErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
