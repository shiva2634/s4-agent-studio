import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { BuildMissionTarget } from "@s4/shared";
import {
  archiveBusinessProjectIntake,
  createBusinessProjectIntake,
  db,
  getBusinessProjectIntakeById,
  listBusinessProjectIntakes,
  listBusinessProjectPrdEvents,
  markBusinessProjectIntakeBuildMissionHandoff,
  updateBusinessProjectIntake,
  type BusinessProjectIntakeFilters,
  type BusinessProjectIntakeInput,
  type BusinessProjectIntakePatch
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";
import { SelfBuildReadinessError, createBuildMissionDraft } from "./self-build-readiness.js";
import { PermissionDeniedError, sanitizeForPolicy } from "./security-policy.js";

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

  app.post("/api/business-control-centre/project-intakes/:id/create-build-mission", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    const intake = getBusinessProjectIntakeById(db, readRouteId(request.params));
    if (!intake) return reply.status(404).send({ error: "Project intake not found" });
    if (intake.appStudioBuildMissionId) {
      return reply.status(409).send({
        error: "Build mission handoff already exists",
        buildMissionId: intake.appStudioBuildMissionId,
        intake
      });
    }
    const eligibilityError = validateBuildMissionHandoffEligibility(intake);
    if (eligibilityError) return reply.status(400).send({ error: eligibilityError });

    const appStudioProject = findActiveAppStudioProject();
    if (!appStudioProject) return reply.status(409).send({ error: "No active App Studio project is registered for build mission handoff" });

    const timestamp = new Date().toISOString();
    const buildMissionId = nanoid();
    try {
      const mission = createBuildMissionDraft(db, {
        id: buildMissionId,
        projectId: appStudioProject.id,
        targetModule: targetModuleForIntake(intake),
        scope: buildMissionScopeForIntake(intake),
        dependencies: dependenciesForIntake(intake),
        riskLevel: riskLevelForIntake(intake.priority),
        gitMode: "WORKTREE",
        now: timestamp,
        audit: audit
      });
      const updatedIntake = markBusinessProjectIntakeBuildMissionHandoff(db, {
        intakeId: intake.id,
        buildMissionId: mission.id,
        actorUserId: context.user.id,
        now: timestamp
      });
      return reply.status(201).send({
        intake: updatedIntake,
        buildMission: {
          id: mission.id,
          status: mission.status,
          targetModule: mission.targetModule,
          projectId: mission.projectId,
          approvalRequired: true,
          nextAction: "REQUEST_BUILD_MISSION_APPROVAL"
        }
      });
    } catch (error) {
      if (error instanceof SelfBuildReadinessError) return reply.status(error.statusCode).send({ error: error.message });
      if (error instanceof PermissionDeniedError) return reply.status(403).send({ error: error.message });
      return routeError(reply, error, "Unable to create App Studio Build Mission draft");
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

type IntakeForHandoff = NonNullable<ReturnType<typeof getBusinessProjectIntakeById>>;

function validateBuildMissionHandoffEligibility(intake: IntakeForHandoff) {
  if (intake.prdStatus !== "Approved") return "PRD must be approved before App Studio handoff";
  if (intake.workflowStatus !== "READY_FOR_APP_STUDIO") return "Project intake must be ready for App Studio before handoff";
  if (!hasMeaningfulText(intake.projectName) || !hasMeaningfulText(intake.shortSummary) || !hasMeaningfulText(intake.problemStatement)) {
    return "Project intake is missing required mission summary fields";
  }
  if (!hasMeaningfulText(intake.coreModulesRequired) || !hasMeaningfulText(intake.keyFeatures)) {
    return "Core modules and key features are required before App Studio handoff";
  }
  return "";
}

function hasMeaningfulText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length >= 3;
}

function findActiveAppStudioProject() {
  return db.prepare(`SELECT id,name FROM projects
    WHERE status='ACTIVE'
    ORDER BY CASE
      WHEN lower(name) IN ('s4 agent studio','shrinika automation studio','shrinika automation studio / business control centre') THEN 0
      ELSE 1
    END, created_at DESC
    LIMIT 1`).get() as { id: string; name: string } | undefined;
}

function targetModuleForIntake(intake: IntakeForHandoff): BuildMissionTarget {
  const text = `${intake.projectName} ${intake.shortSummary} ${intake.coreModulesRequired ?? ""} ${intake.keyFeatures ?? ""}`.toLowerCase();
  if (text.includes("client portal")) return "Client Portal";
  if (text.includes("business control")) return "Business Control Centre";
  if (text.includes("finance") || text.includes("billing") || text.includes("invoice")) return "Finance & Billing Studio";
  if (text.includes("cloud") || text.includes("deployment")) return "Cloud Studio";
  if (text.includes("crm") || intake.projectType === "CRM") return "CRM";
  return "General Custom Module";
}

function riskLevelForIntake(priority: string) {
  if (priority === "Urgent") return "critical";
  if (priority === "High") return "high";
  if (priority === "Low") return "low";
  return "medium";
}

function dependenciesForIntake(intake: IntakeForHandoff) {
  return [
    `Project type: ${intake.projectType}`,
    `PRD status: ${intake.prdStatus}`,
    `Final approval owner: ${intake.finalApprovalOwner}`
  ];
}

function buildMissionScopeForIntake(intake: IntakeForHandoff) {
  const lines = [
    `Create a governed App Studio Build Mission draft for Business Control Centre intake "${intake.projectName}".`,
    `Client/internal company: ${intake.clientOrCompanyName}.`,
    `Short summary: ${intake.shortSummary}`,
    `Problem statement: ${intake.problemStatement}`,
    `Core modules required: ${intake.coreModulesRequired}`,
    `Key features: ${intake.keyFeatures}`,
    intake.targetUsers ? `Target users: ${intake.targetUsers}` : "",
    intake.integrationsNeeded ? `Integrations needed: ${intake.integrationsNeeded}` : "",
    intake.risksAssumptions ? `Risks and assumptions: ${intake.risksAssumptions}` : "",
    "Governance boundary: create a planning-only draft. Do not approve, run agents, modify files, or deploy automatically."
  ];
  return lines.filter(Boolean).join("\n");
}

function audit(eventType: string, summary: string, values: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown } = {}) {
  const timestamp = new Date().toISOString();
  const cleanSummary = sanitizeForPolicy(db, summary, { projectId: values.projectId, taskId: values.taskId, source: "business-project-intake-handoff-audit", now: timestamp });
  const cleanPayload = values.payload ? JSON.parse(sanitizeForPolicy(db, JSON.stringify(values.payload), { projectId: values.projectId, taskId: values.taskId, source: "business-project-intake-handoff-audit-payload", now: timestamp })) as unknown : null;
  db.prepare(`INSERT INTO audit_events (id,project_id,task_id,agent_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(nanoid(), values.projectId ?? null, values.taskId ?? null, values.agentId ?? null, eventType, cleanSummary, cleanPayload ? JSON.stringify(cleanPayload) : null, timestamp);
}
