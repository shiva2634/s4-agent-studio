import assert from "node:assert/strict";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-business-auth-middleware-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const dbModule = await import("@s4/db");
const {
  db,
  createBusinessAuthSession,
  hashBusinessSessionToken,
  revokeBusinessAuthSession
} = dbModule;
const middleware = await import("./business-auth-middleware.js");
const {
  getBusinessAuthContext,
  requireBusinessSession,
  requireInternalUser,
  requireBusinessPermission,
  requireBusinessRole,
  withBusinessPermission
} = middleware;

const app = Fastify({ logger: false });

app.get("/test/session", async (request, reply) => {
  const context = requireBusinessSession(request, reply);
  if (!context) return;
  return { ok: true, userId: context.user.id, sessionId: context.session.id };
});

app.get("/test/internal", async (request, reply) => {
  const context = requireInternalUser(request, reply);
  if (!context) return;
  return { ok: true, userId: context.user.id };
});

app.get("/test/permission/audit-view", async (request, reply) => {
  const context = requireBusinessPermission(request, reply, "audit.view");
  if (!context) return;
  return { ok: true, userId: context.user.id };
});

app.get("/test/permission/company-admin-override", async (request, reply) => {
  const context = requireBusinessPermission(request, reply, { module: "company", action: "admin_override" });
  if (!context) return;
  return { ok: true, userId: context.user.id };
});

app.get("/test/role/system-guardian", async (request, reply) => {
  const context = requireBusinessRole(request, reply, "system_guardian");
  if (!context) return;
  return { ok: true, userId: context.user.id };
});

app.get("/test/role/manager", async (request, reply) => {
  const context = requireBusinessRole(request, reply, "manager");
  if (!context) return;
  return { ok: true, userId: context.user.id };
});

app.get("/test/wrapped", withBusinessPermission("audit.view", async (_request, _reply, context) => ({
  ok: true,
  userId: context.user.id
})));

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
  }) as { id: string; userId: string; expiresAt: string };
}

function insertBusinessUser(input: { id: string; email: string; userType?: "INTERNAL" | "EXTERNAL_CLIENT"; status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" }) {
  db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'created','created')`).run(input.id, input.email, input.id, input.userType ?? "INTERNAL", input.status ?? "ACTIVE");
}

function insertForcedSession(input: { id: string; userId: string; rawToken: string; expiresAt?: string; status?: "ACTIVE" | "REVOKED" | "EXPIRED"; revokedAt?: string | null }) {
  db.prepare(`INSERT INTO business_auth_sessions
    (id,user_id,session_token_hash,status,created_at,last_seen_at,expires_at,revoked_at,revoked_reason,ip_address_hash,user_agent_hash,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id,
    input.userId,
    hashBusinessSessionToken(input.rawToken),
    input.status ?? "ACTIVE",
    "created",
    "created",
    input.expiresAt ?? "2099-01-01T00:00:00.000Z",
    input.revokedAt ?? null,
    null,
    null,
    null,
    null
  );
}

function deniedCount(module: string, action: string) {
  return (db.prepare("SELECT COUNT(*) AS count FROM denied_access_events WHERE attempted_module=? AND attempted_action=?").get(module, action) as { count: number }).count;
}

describe("Business Control Centre auth middleware", () => {
  it("allows valid internal sessions and returns sanitized context only", async () => {
    const rawToken = "owner-session-token";
    const session = createInternalSession("business-user-shrinika", rawToken);

    const response = await app.inject({
      method: "GET",
      url: "/test/session",
      headers: { cookie: cookie(rawToken) }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, userId: "business-user-shrinika", sessionId: session.id });
    assert.ok(!response.body.includes(rawToken));
    assert.ok(!response.body.includes("scrypt$"));

    const request = { headers: { cookie: cookie(rawToken) }, url: "/manual", method: "GET" };
    const context = getBusinessAuthContext(request as any);
    assert.equal(context?.user.id, "business-user-shrinika");
    assert.ok(context?.user.roles.includes("main_admin_owner"));
    assert.ok(context?.user.permissions.includes("deployment.deploy"));
    assert.equal(context?.session.id, session.id);
  });

  it("rejects missing, invalid, expired, and revoked sessions with 401", async () => {
    const missing = await app.inject({ method: "GET", url: "/test/session" });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { authenticated: false, error: "Unauthenticated" });

    const invalid = await app.inject({
      method: "GET",
      url: "/test/session",
      headers: { cookie: cookie("invalid-session-token") }
    });
    assert.equal(invalid.statusCode, 401);

    const expiredToken = "expired-middleware-token";
    createInternalSession("business-user-shrinika", expiredToken, "2020-01-01T00:00:00.000Z");
    const expired = await app.inject({
      method: "GET",
      url: "/test/session",
      headers: { cookie: cookie(expiredToken) }
    });
    assert.equal(expired.statusCode, 401);

    const revokedToken = "revoked-middleware-token";
    const revokedSession = createInternalSession("business-user-shrinika", revokedToken);
    revokeBusinessAuthSession(db, revokedSession.id, "test revoke", "2026-01-01T00:01:00.000Z");
    const revoked = await app.inject({
      method: "GET",
      url: "/test/session",
      headers: { cookie: cookie(revokedToken) }
    });
    assert.equal(revoked.statusCode, 401);

    for (const response of [missing, invalid, expired, revoked]) {
      assert.ok(!response.body.includes("invalid-session-token"));
      assert.ok(!response.body.includes("expired-middleware-token"));
      assert.ok(!response.body.includes("revoked-middleware-token"));
      assert.ok(!response.body.includes("cookie"));
    }
    assert.ok(deniedCount("auth", "session") >= 4);
  });

  it("rejects forced external, suspended, and archived sessions with 403", async () => {
    insertBusinessUser({ id: "business-user-forced-external", email: "forced-external@example.local", userType: "EXTERNAL_CLIENT" });
    insertForcedSession({ id: "forced-external-session", userId: "business-user-forced-external", rawToken: "forced-external-token" });

    insertBusinessUser({ id: "business-user-forced-suspended", email: "forced-suspended@example.local", status: "SUSPENDED" });
    insertForcedSession({ id: "forced-suspended-session", userId: "business-user-forced-suspended", rawToken: "forced-suspended-token" });

    insertBusinessUser({ id: "business-user-forced-archived", email: "forced-archived@example.local", status: "ARCHIVED" });
    insertForcedSession({ id: "forced-archived-session", userId: "business-user-forced-archived", rawToken: "forced-archived-token" });

    for (const rawToken of ["forced-external-token", "forced-suspended-token", "forced-archived-token"]) {
      const response = await app.inject({
        method: "GET",
        url: "/test/internal",
        headers: { cookie: cookie(rawToken) }
      });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { authenticated: false, error: "Forbidden" });
      assert.ok(!response.body.includes(rawToken));
    }
    assert.ok(deniedCount("auth", "internal_user") >= 3);
  });

  it("allows seeded owner and guardian permissions and wrapper usage", async () => {
    const ownerToken = "owner-permission-token";
    createInternalSession("business-user-shrinika", ownerToken);
    const owner = await app.inject({
      method: "GET",
      url: "/test/permission/company-admin-override",
      headers: { cookie: cookie(ownerToken) }
    });
    assert.equal(owner.statusCode, 200);

    const guardianToken = "guardian-permission-token";
    createInternalSession("business-user-shiva", guardianToken);
    const guardian = await app.inject({
      method: "GET",
      url: "/test/permission/audit-view",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(guardian.statusCode, 200);

    const wrapped = await app.inject({
      method: "GET",
      url: "/test/wrapped",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(wrapped.statusCode, 200);
    assert.deepEqual(wrapped.json(), { ok: true, userId: "business-user-shiva" });
  });

  it("rejects missing permissions and records denied access events", async () => {
    const guardianToken = "guardian-missing-permission-token";
    createInternalSession("business-user-shiva", guardianToken);
    const before = deniedCount("company", "admin_override");
    const response = await app.inject({
      method: "GET",
      url: "/test/permission/company-admin-override",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { authenticated: false, error: "Forbidden" });
    assert.ok(!response.body.includes(guardianToken));
    assert.equal(deniedCount("company", "admin_override"), before + 1);
  });

  it("allows correct roles and rejects missing roles with denied events", async () => {
    const guardianToken = "guardian-role-token";
    createInternalSession("business-user-shiva", guardianToken);
    const allowed = await app.inject({
      method: "GET",
      url: "/test/role/system-guardian",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(allowed.statusCode, 200);

    const before = deniedCount("role", "manager");
    const denied = await app.inject({
      method: "GET",
      url: "/test/role/manager",
      headers: { cookie: cookie(guardianToken) }
    });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(denied.json(), { authenticated: false, error: "Forbidden" });
    assert.ok(!denied.body.includes(guardianToken));
    assert.equal(deniedCount("role", "manager"), before + 1);
  });
});
