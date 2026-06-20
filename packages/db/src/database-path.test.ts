import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { findWorkspaceRoot, getResolvedDatabasePath } from "./database-path.js";

describe("database path resolution", () => {
  it("resolves the default database from the workspace root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-db-root-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "s4-agent-studio", workspaces: ["apps/*", "packages/*"] }));
      await fs.mkdir(path.join(root, "apps", "api"), { recursive: true });

      const cwd = path.join(root, "apps", "api");
      assert.equal(findWorkspaceRoot(cwd), root);
      assert.equal(getResolvedDatabasePath({ cwd, env: {} }), path.join(root, "data", "s4-agent-studio.db"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects S4_DB_PATH override", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-db-override-"));
    try {
      const overridePath = path.join(root, "custom", "internal.db");
      assert.equal(getResolvedDatabasePath({ cwd: root, env: { S4_DB_PATH: overridePath } }), overridePath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
