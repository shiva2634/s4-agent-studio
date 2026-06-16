import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getProjectManagementActions } from "../../web/src/project-management.js";

describe("project management actions", () => {
  it("shows only de-register for archived projects", () => {
    assert.deepEqual(getProjectManagementActions("ARCHIVED"), ["De-register Project"]);
  });

  it("shows the expected actions for active and paused projects", () => {
    assert.deepEqual(getProjectManagementActions("ACTIVE"), ["Pause Project", "Archive Project", "De-register Project"]);
    assert.deepEqual(getProjectManagementActions("PAUSED"), ["Resume Project", "Archive Project", "De-register Project"]);
  });
});
