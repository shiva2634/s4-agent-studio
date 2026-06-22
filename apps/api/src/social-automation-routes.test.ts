import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-social-automation-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "social-automation.db");

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

describe("Social Automation Studio backend foundation API", () => {
  it("returns empty summary counts on a fresh database and protects the internal routes", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/business-control-centre/social-automation/summary" });
    assert.equal(missing.statusCode, 401);

    insertBusinessUser({ id: "business-user-social-support", email: "social-support@example.local" });
    assignBusinessRoleToUser(db, { userId: "business-user-social-support", roleKey: "support_manager", now: "2026-01-01T00:00:00.000Z" });
    const supportCookie = createInternalSession("business-user-social-support", "social-support-token");
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/social-automation/summary",
      headers: { cookie: supportCookie }
    });
    assert.equal(forbidden.statusCode, 403);

    const ownerCookie = createInternalSession("business-user-shrinika", "social-owner-token");
    const summary = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/social-automation/summary",
      headers: { cookie: ownerCookie }
    });
    assert.equal(summary.statusCode, 200);
    const body = summary.json() as {
      counts: Record<string, number>;
      recent: Record<string, unknown[]>;
      authenticatedUser: { id: string };
    };
    assert.equal(body.authenticatedUser.id, "business-user-shrinika");
    assert.deepEqual(body.counts, {
      customers: 0,
      contentIdeas: 0,
      generationJobs: 0,
      complianceItems: 0,
      publishingTasks: 0,
      metaAdsIntakes: 0,
      brandCampaigns: 0,
      creditLedgerEntries: 0,
      supportTickets: 0,
      analyticsEvents: 0
    });
    assert.deepEqual(Object.fromEntries(Object.entries(body.recent).map(([key, value]) => [key, value.length])), {
      customers: 0,
      contentIdeas: 0,
      generationJobs: 0,
      complianceItems: 0,
      publishingTasks: 0,
      metaAdsIntakes: 0,
      brandCampaignIntakes: 0,
      creditLedgerEntries: 0,
      supportTickets: 0,
      analyticsEvents: 0
    });
  });

  it("stores governed Social Automation Studio starter records with safe statuses", async () => {
    const ownerCookie = createInternalSession("business-user-shrinika", "social-write-token");

    const customer = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/customers",
      headers: { cookie: ownerCookie },
      payload: {
        displayName: "Lead Contact",
        companyName: "Shrinika Technologies",
        sourceChannel: "website",
        recordType: "LEAD",
        notes: "Initial lead record"
      }
    });
    assert.equal(customer.statusCode, 201);
    const customerBody = customer.json() as { customer: { id: string; recordType: string; status: string } };
    assert.equal(customerBody.customer.recordType, "LEAD");
    assert.equal(customerBody.customer.status, "NEW");

    const contentIdea = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/content-ideas",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        title: "Wealth content hook",
        summary: "Create a governed content idea for internal review only.",
        sourceChannel: "internal"
      }
    });
    assert.equal(contentIdea.statusCode, 201);
    const contentIdeaBody = contentIdea.json() as { contentIdea: { id: string; status: string; customerId: string } };
    assert.equal(contentIdeaBody.contentIdea.status, "INTAKE_READY");
    assert.equal(contentIdeaBody.contentIdea.customerId, customerBody.customer.id);

    const generationJob = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/generation-jobs",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        contentIdeaId: contentIdeaBody.contentIdea.id,
        jobType: "SCRIPT",
        providerKey: "openai",
        requestNote: "Placeholder generation job for governed workflow"
      }
    });
    assert.equal(generationJob.statusCode, 201);
    assert.equal((generationJob.json() as { generationJob: { status: string } }).generationJob.status, "QUEUED");

    const complianceItem = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/compliance-items",
      headers: { cookie: ownerCookie },
      payload: {
        sourceType: "CONTENT_IDEA",
        sourceId: contentIdeaBody.contentIdea.id,
        title: "Content compliance review",
        riskLevel: "MEDIUM"
      }
    });
    assert.equal(complianceItem.statusCode, 201);
    assert.equal((complianceItem.json() as { complianceItem: { status: string } }).complianceItem.status, "OPEN");

    const publishingTask = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/publishing-tasks",
      headers: { cookie: ownerCookie },
      payload: {
        sourceType: "CONTENT_IDEA",
        sourceId: contentIdeaBody.contentIdea.id,
        platformKey: "manual",
        title: "Publishing approval task"
      }
    });
    assert.equal(publishingTask.statusCode, 201);
    assert.equal((publishingTask.json() as { publishingTask: { status: string } }).publishingTask.status, "DRAFT");

    const metaAds = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/meta-ads-intakes",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        campaignName: "Internal Meta Ads intake"
      }
    });
    assert.equal(metaAds.statusCode, 201);
    assert.equal((metaAds.json() as { metaAdsIntake: { status: string } }).metaAdsIntake.status, "INTAKE_READY");

    const brandCampaign = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/brand-campaign-intakes",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        campaignName: "Third-party marketplace intake"
      }
    });
    assert.equal(brandCampaign.statusCode, 201);
    assert.equal((brandCampaign.json() as { brandCampaignIntake: { status: string } }).brandCampaignIntake.status, "INTAKE_READY");

    const creditLedger = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/credit-ledger",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        entryType: "ALLOCATION",
        amountCents: 0,
        currencyCode: "INR"
      }
    });
    assert.equal(creditLedger.statusCode, 201);
    assert.equal((creditLedger.json() as { creditLedgerEntry: { status: string } }).creditLedgerEntry.status, "DRAFT");

    const supportTicket = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/support-tickets",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        title: "Customer support placeholder",
        summary: "Internal support intake placeholder only.",
        channel: "website"
      }
    });
    assert.equal(supportTicket.statusCode, 201);
    assert.equal((supportTicket.json() as { supportTicket: { status: string } }).supportTicket.status, "OPEN");

    const analyticsEvent = await app.inject({
      method: "POST",
      url: "/api/business-control-centre/social-automation/analytics-events",
      headers: { cookie: ownerCookie },
      payload: {
        customerId: customerBody.customer.id,
        eventKey: "empty_state_loaded",
        eventName: "Empty state loaded",
        sourceType: "CONTENT_IDEA",
        sourceId: contentIdeaBody.contentIdea.id
      }
    });
    assert.equal(analyticsEvent.statusCode, 201);
    assert.equal((analyticsEvent.json() as { analyticsEvent: { eventStatus: string } }).analyticsEvent.eventStatus, "EMPTY_STATE");

    const summary = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/social-automation/summary",
      headers: { cookie: ownerCookie }
    });
    assert.equal(summary.statusCode, 200);
    const body = summary.json() as { counts: Record<string, number>; recent: Record<string, unknown[]> };
    assert.deepEqual(body.counts, {
      customers: 1,
      contentIdeas: 1,
      generationJobs: 1,
      complianceItems: 1,
      publishingTasks: 1,
      metaAdsIntakes: 1,
      brandCampaigns: 1,
      creditLedgerEntries: 1,
      supportTickets: 1,
      analyticsEvents: 1
    });
  });
});
