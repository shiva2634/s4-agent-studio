import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeploymentHardeningStatus, securityHeaders } from "./deployment-hardening.js";

describe("deployment hardening status", () => {
  it("returns redacted production config status with missing names only", () => {
    const status = buildDeploymentHardeningStatus({
      NODE_ENV: "production",
      S4_DB_PATH: "C:/secret/path/app.db",
      S4_WEB_ORIGINS: "https://internal.example.test",
      S4_INTERNAL_APP_ORIGIN: "",
      S4_API_PUBLIC_ORIGIN: "",
      S4_BACKUP_LOCATION: "",
      S4_LOG_RETENTION_DAYS: "",
      AI_API_KEY: "sk-should-never-return",
      SESSION_SECRET: "hidden-session-secret"
    });

    assert.equal(status.environment, "production");
    assert.ok(status.missingConfigNames.includes("S4_INTERNAL_APP_ORIGIN"));
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes("C:/secret/path/app.db"));
    assert.ok(!serialized.includes("https://internal.example.test"));
    assert.ok(!serialized.includes("sk-should-never-return"));
    assert.ok(!serialized.includes("hidden-session-secret"));
  });

  it("fails unsafe production CORS and warns outside production", () => {
    const unsafeProduction = buildDeploymentHardeningStatus({
      NODE_ENV: "production",
      S4_DB_PATH: "set",
      S4_WEB_ORIGINS: "*",
      S4_INTERNAL_APP_ORIGIN: "set",
      S4_API_PUBLIC_ORIGIN: "set",
      S4_BACKUP_LOCATION: "set",
      S4_LOG_RETENTION_DAYS: "set"
    });
    assert.equal(unsafeProduction.checks.find((check) => check.key === "cors_allowlist")?.status, "FAIL");

    const local = buildDeploymentHardeningStatus({ NODE_ENV: "test" });
    assert.equal(local.environment, "non-production");
    assert.equal(local.checks.find((check) => check.key === "secure_session_cookie")?.status, "WARN");
  });

  it("defines safe baseline security headers", () => {
    assert.equal(securityHeaders["X-Content-Type-Options"], "nosniff");
    assert.equal(securityHeaders["X-Frame-Options"], "DENY");
    assert.ok(!JSON.stringify(securityHeaders).includes("secret"));
  });
});
