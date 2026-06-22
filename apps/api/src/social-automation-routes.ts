import type { FastifyInstance } from "fastify";
import {
  createSocialAutomationAnalyticsEvent,
  createSocialAutomationBrandCampaignIntake,
  createSocialAutomationComplianceItem,
  createSocialAutomationContentIdea,
  createSocialAutomationCreditLedgerEntry,
  createSocialAutomationCustomerLead,
  createSocialAutomationGenerationJob,
  createSocialAutomationMetaAdsIntake,
  createSocialAutomationPublishingTask,
  createSocialAutomationSupportTicket,
  db,
  getSocialAutomationIntakes,
  getSocialAutomationSummary,
  socialAutomationCreditLedgerEntryTypes,
  socialAutomationGenerationJobTypes,
  socialAutomationPublishingPlatformKeys,
  socialAutomationSourceTypes
} from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

type Body = Record<string, unknown>;

export function registerSocialAutomationRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/social-automation/summary", withBusinessPermission("app_studio.view", async (_request, _reply, context) => ({
    module: "social-automation",
    workspace: "Social Automation Studio",
    internalOnly: true,
    authenticatedUser: {
      id: context.user.id,
      displayName: context.user.displayName
    },
    ...getSocialAutomationSummary(db)
  })));

  app.get("/api/business-control-centre/social-automation/intakes", withBusinessPermission("app_studio.view", async () => ({
    module: "social-automation",
    internalOnly: true,
    ...getSocialAutomationIntakes(db)
  })));

  app.get("/api/business-control-centre/social-automation/customers", withBusinessPermission("app_studio.view", async () => ({
    module: "social-automation",
    internalOnly: true,
    customers: getSocialAutomationIntakes(db).customers
  })));

  app.post("/api/business-control-centre/social-automation/customers", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ customer: createSocialAutomationCustomerLead(db, { ...readCustomerBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation customer record");
    }
  }));

  app.post("/api/business-control-centre/social-automation/content-ideas", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ contentIdea: createSocialAutomationContentIdea(db, { ...readContentIdeaBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation content idea");
    }
  }));

  app.post("/api/business-control-centre/social-automation/generation-jobs", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ generationJob: createSocialAutomationGenerationJob(db, { ...readGenerationJobBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation generation job");
    }
  }));

  app.post("/api/business-control-centre/social-automation/compliance-items", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ complianceItem: createSocialAutomationComplianceItem(db, { ...readComplianceItemBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation compliance item");
    }
  }));

  app.post("/api/business-control-centre/social-automation/publishing-tasks", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ publishingTask: createSocialAutomationPublishingTask(db, { ...readPublishingTaskBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation publishing task");
    }
  }));

  app.post("/api/business-control-centre/social-automation/meta-ads-intakes", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ metaAdsIntake: createSocialAutomationMetaAdsIntake(db, { ...readMetaAdsIntakeBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation meta ads intake");
    }
  }));

  app.post("/api/business-control-centre/social-automation/brand-campaign-intakes", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ brandCampaignIntake: createSocialAutomationBrandCampaignIntake(db, { ...readBrandCampaignIntakeBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation brand campaign intake");
    }
  }));

  app.post("/api/business-control-centre/social-automation/support-tickets", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ supportTicket: createSocialAutomationSupportTicket(db, { ...readSupportTicketBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation support ticket");
    }
  }));

  app.post("/api/business-control-centre/social-automation/credit-ledger", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ creditLedgerEntry: createSocialAutomationCreditLedgerEntry(db, { ...readCreditLedgerBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation credit ledger entry");
    }
  }));

  app.post("/api/business-control-centre/social-automation/analytics-events", withBusinessPermission("app_studio.create", async (request, reply, context) => {
    try {
      return reply.status(201).send({ analyticsEvent: createSocialAutomationAnalyticsEvent(db, { ...readAnalyticsEventBody(request.body), actorUserId: context.user.id }) });
    } catch (error) {
      return routeError(reply, error, "Unable to create social automation analytics event");
    }
  }));
}

function readCustomerBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    recordType: readOptionalChoice(value, "recordType", ["LEAD", "CUSTOMER"] as const) ?? "LEAD",
    displayName: readString(value, "displayName"),
    companyName: readOptionalString(value, "companyName"),
    sourceChannel: readString(value, "sourceChannel"),
    notes: readOptionalString(value, "notes")
  };
}

function readContentIdeaBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    title: readString(value, "title"),
    summary: readString(value, "summary"),
    contentFormat: readOptionalString(value, "contentFormat"),
    sourceChannel: readOptionalString(value, "sourceChannel")
  };
}

function readGenerationJobBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    contentIdeaId: readOptionalString(value, "contentIdeaId"),
    jobType: readChoice(value, "jobType", socialAutomationGenerationJobTypes),
    providerKey: readChoice(value, "providerKey", ["openai", "nvidia", "manual"] as const),
    requestNote: readString(value, "requestNote")
  };
}

function readComplianceItemBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    sourceType: readChoice(value, "sourceType", socialAutomationSourceTypes),
    sourceId: readOptionalString(value, "sourceId"),
    title: readString(value, "title"),
    notes: readOptionalString(value, "notes"),
    riskLevel: readOptionalChoice(value, "riskLevel", ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) ?? "MEDIUM"
  };
}

function readPublishingTaskBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    sourceType: readChoice(value, "sourceType", socialAutomationSourceTypes),
    sourceId: readOptionalString(value, "sourceId"),
    platformKey: readChoice(value, "platformKey", socialAutomationPublishingPlatformKeys),
    title: readString(value, "title"),
    notes: readOptionalString(value, "notes"),
    scheduledFor: readOptionalString(value, "scheduledFor")
  };
}

function readMetaAdsIntakeBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    campaignName: readString(value, "campaignName"),
    objective: readOptionalString(value, "objective"),
    notes: readOptionalString(value, "notes")
  };
}

function readBrandCampaignIntakeBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    campaignName: readString(value, "campaignName"),
    objective: readOptionalString(value, "objective"),
    notes: readOptionalString(value, "notes")
  };
}

function readCreditLedgerBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    entryType: readChoice(value, "entryType", socialAutomationCreditLedgerEntryTypes),
    amountCents: readInteger(value, "amountCents"),
    currencyCode: readOptionalString(value, "currencyCode") ?? "INR",
    note: readOptionalString(value, "note")
  };
}

function readSupportTicketBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    title: readString(value, "title"),
    summary: readString(value, "summary"),
    priority: readOptionalChoice(value, "priority", ["LOW", "MEDIUM", "HIGH", "URGENT"] as const) ?? "MEDIUM",
    channel: readString(value, "channel"),
    notes: readOptionalString(value, "notes")
  };
}

function readAnalyticsEventBody(body: unknown) {
  const value = readObjectBody(body);
  return {
    customerId: readOptionalString(value, "customerId"),
    eventKey: readString(value, "eventKey"),
    eventName: readString(value, "eventName"),
    sourceType: readOptionalChoice(value, "sourceType", socialAutomationSourceTypes) ?? null,
    sourceId: readOptionalString(value, "sourceId"),
    eventValue: readOptionalString(value, "eventValue"),
    notes: readOptionalString(value, "notes")
  };
}

function readObjectBody(body: unknown): Body {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request body");
  return body as Body;
}

function readString(body: Body, key: string) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function readOptionalString(body: Body, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInteger(body: Body, key: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is required`);
  return Math.trunc(value);
}

function readChoice<T extends readonly string[]>(body: Body, key: string, allowed: T): T[number] {
  const value = readString(body, key);
  if (!allowed.includes(value)) throw new Error(`${key} is invalid`);
  return value as T[number];
}

function readOptionalChoice<T extends readonly string[]>(body: Body, key: string, allowed: T): T[number] | null {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (!allowed.includes(normalized)) throw new Error(`${key} is invalid`);
  return normalized as T[number];
}

function routeError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown, fallback: string) {
  return reply.status(400).send({ error: error instanceof Error ? error.message : fallback });
}
