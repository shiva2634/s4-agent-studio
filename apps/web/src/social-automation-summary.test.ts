import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeSocialAutomationSummary } from "./social-automation-summary";

test("social automation summary normalization", async t => {
  await t.test("fills missing counts with zeros and redacts unsafe response values", () => {
    const normalized = normalizeSocialAutomationSummary({
      counts: {
        customers: 4,
        contentIdeas: "bad",
        generationJobs: -1,
        complianceItems: 2,
        publishingTasks: 1,
        metaAdsIntakes: 0,
        brandCampaigns: 3,
        creditLedgerEntries: 6,
        supportTickets: 7,
        analyticsEvents: 8
      },
      warnings: ["safe"],
      authenticatedUser: { id: "user-1", displayName: "Shrinika" },
      apiKey: "secret"
    });

    assert.ok(normalized);
    assert.deepEqual(normalized?.counts, {
      customers: 4,
      contentIdeas: 0,
      generationJobs: 0,
      complianceItems: 2,
      publishingTasks: 1,
      metaAdsIntakes: 0,
      brandCampaigns: 3,
      creditLedgerEntries: 6,
      supportTickets: 7,
      analyticsEvents: 8
    });
    assert.deepEqual(normalized?.warnings, ["safe"]);
    assert.deepEqual(normalized?.authenticatedUser, { id: "user-1", displayName: "Shrinika" });
  });

  await t.test("returns null for invalid payloads", () => {
    assert.equal(normalizeSocialAutomationSummary(null), null);
    assert.equal(normalizeSocialAutomationSummary("invalid"), null);
  });
});
