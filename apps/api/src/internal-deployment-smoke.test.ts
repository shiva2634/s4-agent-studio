import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
// TypeScript does not infer declarations for this repo-local .mjs script import.
// @ts-expect-error repo-local smoke script is exercised directly by the test harness
import { formatInternalDeploymentSmokeReport, runInternalDeploymentSmoke } from "../../../scripts/internal-deployment-smoke.mjs";

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("internal deployment smoke script", () => {
  it("does not print secret values when env examples are unsafe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-internal-smoke-"));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, "apps", "api", "src"), { recursive: true });
    await fs.mkdir(path.join(root, "apps", "web"), { recursive: true });
    await fs.mkdir(path.join(root, "packages", "db", "src"), { recursive: true });
    await fs.mkdir(path.join(root, "docs"), { recursive: true });

    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "s4-agent-studio",
      scripts: {
        typecheck: "npm run typecheck --workspaces --if-present",
        test: "npm run test --workspaces --if-present",
        "db:init": "npm run db:init -w @s4/db",
        "internal:smoke": "tsx scripts/internal-deployment-smoke.mjs"
      }
    }));
    await fs.writeFile(path.join(root, "apps", "api", "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "node --test" } }));
    await fs.writeFile(path.join(root, "apps", "web", "package.json"), JSON.stringify({ scripts: { typecheck: "tsc -b" } }));
    await fs.writeFile(path.join(root, "packages", "db", "package.json"), JSON.stringify({ scripts: { "db:init": "tsx src/init.ts", test: "node --test" } }));
    await fs.writeFile(path.join(root, "apps", "api", "src", "business-control-centre-routes.ts"), [
      'app.get("/api/business-control-centre/system-health", withBusinessPermission("system.view", async () => ({})));',
      'app.get("/api/business-control-centre/deployment-hardening-status", withBusinessPermission("system.view", async () => ({})));',
      'app.get("/api/business-control-centre/internal-smoke-test-status", withBusinessPermission("system.view", async () => ({})));'
    ].join("\n"));
    await fs.writeFile(path.join(root, "apps", "api", "src", "app-studio-internal-routes.ts"), [
      'app.get("/api/app-studio/internal/overview", withBusinessPermission("app_studio.view", async () => ({})));',
      'app.get("/api/app-studio/internal/build-missions", withBusinessPermission("app_studio.create", async () => ({})));',
      'app.get("/api/app-studio/internal/security-status", withBusinessPermission("app_studio.audit", async () => ({})));'
    ].join("\n"));
    await fs.writeFile(path.join(root, "apps", "api", "src", "business-auth.ts"), [
      'app.post("/api/business-auth/login", async () => ({}));',
      'app.post("/api/business-auth/logout", async () => ({}));',
      'app.get("/api/business-auth/current-user", async () => ({}));'
    ].join("\n"));
    await fs.writeFile(path.join(root, "packages", "db", "src", "database-path.ts"), [
      'import path from "node:path";',
      'export function getResolvedDatabasePath(options = {}) {',
      '  return path.resolve(options.cwd ?? process.cwd(), "./data/s4-agent-studio.db");',
      '}',
      'export function fallbackPath(root) {',
      '  return path.join(root, "data", "s4-agent-studio.db");',
      '}'
    ].join("\n"));
    await fs.writeFile(path.join(root, "docs", "internal-deployment-hardening.md"), "# Hardening\n");
    await fs.writeFile(path.join(root, "docs", "final-internal-deployment-smoke-test.md"), "# Smoke\n");
    await fs.writeFile(path.join(root, ".env.example"), [
      "S4_DB_PATH=./data/s4-agent-studio.db",
      "S4_WEB_ORIGINS=http://localhost:5173",
      "S4_INTERNAL_APP_ORIGIN=",
      "S4_API_PUBLIC_ORIGIN=",
      "S4_BACKUP_LOCATION=",
      "S4_LOG_RETENTION_DAYS=",
      "AI_API_KEY=sk-live-very-secret",
      "OVI_API_KEY=ovi-top-secret",
      "LTX_API_KEY=ltx-top-secret"
    ].join("\n"));

    const result = await runInternalDeploymentSmoke({ rootDir: root });
    const report = formatInternalDeploymentSmokeReport(result);

    assert.equal(result.ok, false);
    assert.ok(!report.includes("sk-live-very-secret"));
    assert.ok(!report.includes("ovi-top-secret"));
    assert.ok(!report.includes("ltx-top-secret"));
    assert.ok(report.includes("env_example_safe_and_complete"));
  });

  it("accepts the repository .env.example placeholders as safe", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const result = await runInternalDeploymentSmoke({ rootDir: root });
    const envCheck = result.checks.find((check: { key: string }) => check.key === "env_example_safe_and_complete");
    assert.equal(envCheck?.status, "PASS");
  });
});
