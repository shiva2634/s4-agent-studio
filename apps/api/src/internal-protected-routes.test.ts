import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-internal-protected-routes-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const [{ app }, dbModule] = await Promise.all([import("./server.js"), import("@s4/db")]);
const {
  db,
  assignBusinessRoleToUser,
  createBusinessAuthSession,
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

function createInternalSession(userId: string, rawToken: string, expiresAt = "2099-01-01T00:00:00.000Z") {
  return createBusinessAuthSession(db, {
    userId,
    sessionTokenHash: hashBusinessSessionToken(rawToken),
    expiresAt,
    now: "2026-01-01T00:00:00.000Z"
  }) as { id: string };
}

function insertBusinessUser(input: { id: string; email: string; userType?: "INTERNAL" | "EXTERNAL_CLIENT"; status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" }) {
  db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'created','created')`).run(input.id, input.email, input.id, input.userType ?? "INTERNAL", input.status ?? "ACTIVE");
}

function insertForcedSession(input: { id: string; userId: string; rawToken: string; expiresAt?: string }) {
  db.prepare(`INSERT INTO business_auth_sessions
    (id,user_id,session_token_hash,status,created_at,last_seen_at,expires_at,revoked_at,revoked_reason,ip_address_hash,user_agent_hash,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id,
    input.userId,
    hashBusinessSessionToken(input.rawToken),
    "ACTIVE",
    "created",
    "created",
    input.expiresAt ?? "2099-01-01T00:00:00.000Z",
    null,
    null,
    null,
    null,
    null
  );
}

function deniedCount(module: string, action: string) {
  return (db.prepare("SELECT COUNT(*) AS count FROM denied_access_events WHERE attempted_module=? AND attempted_action=?").get(module, action) as { count: number }).count;
}

function assertNoAuthSecrets(body: string, rawToken: string) {
  assert.ok(!body.includes(rawToken));
  assert.ok(!body.includes("shrinika_internal_session"));
  assert.ok(!body.includes("password"));
  assert.ok(!body.includes("passwordHash"));
  assert.ok(!body.includes("credential"));
  assert.ok(!body.includes("scrypt$"));
}

describe("protected internal Business Control Centre and App Studio routes", () => {
  it("keeps public/system routes open for now", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    assert.equal(bootstrap.statusCode, 200);
  });

  it("protects Business Control Centre overview with company.view", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/business-control-centre/overview" });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { authenticated: false, error: "Unauthenticated" });

    const ownerToken = "owner-bcc-overview-token";
    createInternalSession("business-user-shrinika", ownerToken);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/overview",
      headers: { cookie: cookie(ownerToken) }
    });
    assert.equal(allowed.statusCode, 200);
    const body = allowed.json() as { workspace: string; company: string; internalOnly: boolean; authenticatedUser: { id: string }; counts: { roles: number } };
    assert.equal(body.workspace, "Business Control Centre");
    assert.equal(body.company, "Shrinika Technologies");
    assert.equal(body.internalOnly, true);
    assert.equal(body.authenticatedUser.id, "business-user-shrinika");
    assert.ok(body.counts.roles >= 16);
    assertNoAuthSecrets(allowed.body, ownerToken);
  });

  it("protects Business Control Centre audit, approvals, and system health with seeded permissions", async () => {
    const ownerToken = "owner-bcc-detail-token";
    createInternalSession("business-user-shrinika", ownerToken);

    for (const url of [
      "/api/business-control-centre/audit",
      "/api/business-control-centre/approvals",
      "/api/business-control-centre/system-health"
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: cookie(ownerToken) }
      });
      assert.equal(response.statusCode, 200, url);
      assertNoAuthSecrets(response.body, ownerToken);
    }
  });

  it("protects App Studio internal overview and allows seeded guardian access", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/app-studio/internal/overview" });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { authenticated: false, error: "Unauthenticated" });

    const guardianToken = "guardian-app-studio-overview-token";
    createInternalSession("business-user-shiva", guardianToken);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/app-studio/internal/overview",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(allowed.statusCode, 200);
    const body = allowed.json() as { workspace: string; internalOnly: boolean; authenticatedUser: { id: string }; counts: { agents: number } };
    assert.equal(body.workspace, "App Studio");
    assert.equal(body.internalOnly, true);
    assert.equal(body.authenticatedUser.id, "business-user-shiva");
    assert.ok(body.counts.agents >= 1);
    assertNoAuthSecrets(allowed.body, guardianToken);
  });

  it("protects App Studio build missions and security status with app_studio permissions", async () => {
    const guardianToken = "guardian-app-studio-detail-token";
    createInternalSession("business-user-shiva", guardianToken);

    for (const url of [
      "/api/app-studio/internal/build-missions",
      "/api/app-studio/internal/security-status"
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: cookie(guardianToken) }
      });
      assert.equal(response.statusCode, 200, url);
      assertNoAuthSecrets(response.body, guardianToken);
    }
  });

  it("returns 403 and records denied access when a valid internal user lacks permission", async () => {
    insertBusinessUser({ id: "business-user-frontend-protected", email: "frontend-protected@example.local" });
    assignBusinessRoleToUser(db, {
      userId: "business-user-frontend-protected",
      roleKey: "frontend_developer",
      now: "2026-01-01T00:00:00.000Z"
    });
    const frontendToken = "frontend-missing-permission-token";
    createInternalSession("business-user-frontend-protected", frontendToken);

    const beforeCompany = deniedCount("company", "view");
    const overview = await app.inject({
      method: "GET",
      url: "/api/business-control-centre/overview",
      headers: { cookie: cookie(frontendToken) }
    });
    assert.equal(overview.statusCode, 403);
    assert.deepEqual(overview.json(), { authenticated: false, error: "Forbidden" });
    assert.equal(deniedCount("company", "view"), beforeCompany + 1);
    assertNoAuthSecrets(overview.body, frontendToken);

    const beforeBuildMissions = deniedCount("app_studio", "create");
    const buildMissions = await app.inject({
      method: "GET",
      url: "/api/app-studio/internal/build-missions",
      headers: { cookie: cookie(frontendToken) }
    });
    assert.equal(buildMissions.statusCode, 403);
    assert.equal(deniedCount("app_studio", "create"), beforeBuildMissions + 1);
    assertNoAuthSecrets(buildMissions.body, frontendToken);
  });

  it("rejects external, suspended, and archived sessions for protected internal APIs", async () => {
    insertBusinessUser({ id: "business-user-protected-external", email: "protected-external@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "protected-external-session", userId: "business-user-protected-external", rawToken: "protected-external-token" });

    insertBusinessUser({ id: "business-user-protected-suspended", email: "protected-suspended@example.local" });
    createInternalSession("business-user-protected-suspended", "protected-suspended-token");
    db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-protected-suspended'").run();

    insertBusinessUser({ id: "business-user-protected-archived", email: "protected-archived@example.local" });
    createInternalSession("business-user-protected-archived", "protected-archived-token");
    db.prepare("UPDATE business_users SET status='ARCHIVED' WHERE id='business-user-protected-archived'").run();

    for (const rawToken of ["protected-external-token", "protected-suspended-token", "protected-archived-token"]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/business-control-centre/overview",
        headers: { cookie: cookie(rawToken) }
      });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { authenticated: false, error: "Forbidden" });
      assertNoAuthSecrets(response.body, rawToken);
    }
    assert.ok(deniedCount("auth", "internal_user") >= 3);
  });
});
