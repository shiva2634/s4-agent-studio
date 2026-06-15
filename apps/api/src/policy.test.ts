import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRisk, isMutationRequest, isReadOnlyInspectionRequest, requiresApproval } from "./policy.js";

describe("read-only inspection intent", () => {
  for (const keyword of ["inspect", "review", "identify", "analyse", "analyze", "explain project structure", "list project files", "read-only", "read only", "do not modify", "don't modify", "no changes"]) {
    it(`classifies ${keyword} requests as low risk without approval`, () => {
      const message = `Please ${keyword} this production project and delete nothing`;
      assert.equal(isReadOnlyInspectionRequest(message), true);
      assert.equal(classifyRisk(message), "low");
      assert.equal(requiresApproval(classifyRisk(message)), false);
    });
  }

  it("keeps non-inspection sensitive requests gated", () => {
    assert.equal(isReadOnlyInspectionRequest("delete the production database"), false);
    assert.equal(isMutationRequest("delete the production database"), true);
    assert.equal(classifyRisk("delete the production database"), "critical");
    assert.equal(requiresApproval(classifyRisk("delete the production database")), true);
  });

  it("detects mutation requests separately from read-only inspection intent", () => {
    for (const phrase of ["add", "create", "build", "implement", "fix", "update", "modify", "remove", "delete", "install", "migrate"]) {
      assert.equal(isMutationRequest(`${phrase} the login page`), true);
    }
    assert.equal(isReadOnlyInspectionRequest("explain project structure"), true);
    assert.equal(isMutationRequest("explain project structure"), false);
  });
});
