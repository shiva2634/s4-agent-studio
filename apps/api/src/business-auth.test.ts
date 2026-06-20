import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-business-auth-api-"));
process.env.NODE_ENV = "test";
process.env.S4_DB_PATH = path.join(workspaceRoot, "projects.db");

const [{ app }, dbModule] = await Promise.all([import("./server.js"), import("@s4/db")]);
const {
  db,
  createBusinessAuthSession,
  hashBusinessPassword,
  hashBusinessSessionToken,
  setBusinessUserPasswordCredential,
  revokeBusinessAuthSession
} = dbModule;

after(async () => {
  await app.close();
  db.close();
  delete process.env.S4_DB_PATH;
  delete process.env.NODE_ENV;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

const validPassword = "InternalLoginPassword!2026";
const genericLoginError = "Invalid email or password";

function getSetCookie(response: { headers: Record<string, string | number | string[] | undefined> }) {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function extractSessionToken(setCookie: string) {
  const pair = setCookie.split(";")[0];
  const [, encodedValue] = pair.split("=");
  return decodeURIComponent(encodedValue ?? "");
}

function insertBusinessUser(input: { id: string; email: string; userType?: "INTERNAL" | "EXTERNAL_CLIENT"; status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" }) {
  db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'created','created')`).run(input.id, input.email, input.id, input.userType ?? "INTERNAL", input.status ?? "ACTIVE");
}

describe("Business Control Centre internal auth API", () => {
  it("logs in active internal users, sets an httpOnly cookie, and stores only the session hash", async () => {
    setBusinessUserPasswordCredential(db, "business-user-shrinika", validPassword, "2026-01-01T00:00:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: "/api/business-auth/login",
      payload: { email: " OWNER@Shrinika.Local ", password: validPassword }
    });

    assert.equal(response.statusCode, 200);
    const setCookie = getSetCookie(response);
    assert.ok(setCookie.includes("shrinika_internal_session="));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Lax"));
    assert.ok(setCookie.includes("Path=/"));
    assert.ok(setCookie.includes("Max-Age=28800"));

    const rawSessionToken = extractSessionToken(setCookie);
    assert.ok(rawSessionToken.length >= 40);
    const sessionHash = hashBusinessSessionToken(rawSessionToken);
    const storedSession = db.prepare("SELECT session_token_hash AS sessionTokenHash FROM business_auth_sessions WHERE session_token_hash=?").get(sessionHash) as { sessionTokenHash: string } | undefined;
    assert.equal(storedSession?.sessionTokenHash, sessionHash);
    const rawTokenStored = db.prepare("SELECT COUNT(*) AS count FROM business_auth_sessions WHERE session_token_hash=?").get(rawSessionToken) as { count: number };
    assert.equal(rawTokenStored.count, 0);

    const bodyText = response.body;
    assert.ok(!bodyText.includes(validPassword));
    assert.ok(!bodyText.includes(rawSessionToken));
    assert.ok(!bodyText.includes("scrypt$"));

    const body = response.json() as { authenticated: boolean; user: { id: string; email: string; roles: string[]; permissions: string[] }; session: { expiresAt: string } };
    assert.equal(body.authenticated, true);
    assert.equal(body.user.id, "business-user-shrinika");
    assert.equal(body.user.email, "owner@shrinika.local");
    assert.ok(body.user.roles.includes("main_admin_owner"));
    assert.ok(body.user.permissions.includes("app_studio.view"));
    assert.ok(body.session.expiresAt);
  });

  it("returns sanitized current-user data for a valid cookie and false after logout", async () => {
    setBusinessUserPasswordCredential(db, "business-user-shiva", validPassword, "2026-01-01T00:10:00.000Z");
    const login = await app.inject({
      method: "POST",
      url: "/api/business-auth/login",
      payload: { email: "shiva@shrinika.local", password: validPassword }
    });
    assert.equal(login.statusCode, 200);
    const cookie = getSetCookie(login).split(";")[0];
    const rawSessionToken = extractSessionToken(getSetCookie(login));

    const currentUser = await app.inject({
      method: "GET",
      url: "/api/business-auth/current-user",
      headers: { cookie }
    });
    assert.equal(currentUser.statusCode, 200);
    const currentBody = currentUser.json() as { authenticated: boolean; user: { id: string; roles: string[]; permissions: string[] }; session: { expiresAt: string } };
    assert.equal(currentBody.authenticated, true);
    assert.equal(currentBody.user.id, "business-user-shiva");
    assert.ok(currentBody.user.roles.includes("system_guardian"));
    assert.ok(currentBody.user.permissions.includes("audit.view"));
    assert.ok(currentBody.user.permissions.includes("app_studio.view"));
    assert.ok(!currentUser.body.includes("scrypt$"));
    assert.ok(!currentUser.body.includes(rawSessionToken));

    const logout = await app.inject({
      method: "POST",
      url: "/api/business-auth/logout",
      headers: { cookie }
    });
    assert.equal(logout.statusCode, 200);
    assert.deepEqual(logout.json(), { success: true });
    const clearCookie = getSetCookie(logout);
    assert.ok(clearCookie.includes("shrinika_internal_session="));
    assert.ok(clearCookie.includes("Max-Age=0"));

    const revokedSession = db.prepare("SELECT status FROM business_auth_sessions WHERE session_token_hash=?").get(hashBusinessSessionToken(rawSessionToken)) as { status: string };
    assert.equal(revokedSession.status, "REVOKED");

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/business-auth/current-user",
      headers: { cookie }
    });
    assert.equal(afterLogout.statusCode, 200);
    assert.deepEqual(afterLogout.json(), { authenticated: false });
  });

  it("uses generic login failures and records sanitized failure events", async () => {
    setBusinessUserPasswordCredential(db, "business-user-shrinika", validPassword, "2026-01-01T00:20:00.000Z");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/business-auth/login",
      headers: {
        authorization: "Bearer should-not-be-stored",
        cookie: "external_session=should-not-be-stored"
      },
      payload: { email: "owner@shrinika.local", password: "WrongPassword!2026" }
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), { authenticated: false, error: genericLoginError });

    const missingUser = await app.inject({
      method: "POST",
      url: "/api/business-auth/login",
      payload: { email: "missing@example.local", password: "WrongPassword!2026" }
    });
    assert.equal(missingUser.statusCode, 401);
    assert.deepEqual(missingUser.json(), { authenticated: false, error: genericLoginError });

    const events = db.prepare("SELECT result,reason,metadata_json AS metadataJson FROM business_login_events ORDER BY created_at DESC LIMIT 2").all() as Array<{ result: string; reason: string; metadataJson: string | null }>;
    assert.equal(events.every((event) => event.result === "FAILURE"), true);
    for (const event of events) {
      assert.ok(event.reason);
      assert.ok(!event.metadataJson?.includes("WrongPassword!2026"));
      assert.ok(!event.metadataJson?.includes("should-not-be-stored"));
      assert.ok(!event.metadataJson?.includes("Bearer"));
      assert.ok(!event.metadataJson?.includes("external_session"));
    }
  });

  it("rejects external, inactive, missing, and disabled-credential users with the same generic login response", async () => {
    insertBusinessUser({ id: "business-user-external-login", email: "external-login@example.local", userType: "EXTERNAL_CLIENT" });
    db.prepare(`INSERT INTO business_auth_credentials
      (id,user_id,credential_type,password_hash,password_hash_algorithm,password_updated_at,must_rotate_password,is_enabled,created_at,updated_at)
      VALUES ('external-login-credential','business-user-external-login','PASSWORD_HASH',?,'scrypt.v1','created',0,1,'created','created')`).run(hashBusinessPassword(validPassword));

    insertBusinessUser({ id: "business-user-suspended-login", email: "suspended-login@example.local", status: "ACTIVE" });
    setBusinessUserPasswordCredential(db, "business-user-suspended-login", validPassword, "2026-01-01T00:30:00.000Z");
    db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-suspended-login'").run();

    insertBusinessUser({ id: "business-user-archived-login", email: "archived-login@example.local", status: "ACTIVE" });
    setBusinessUserPasswordCredential(db, "business-user-archived-login", validPassword, "2026-01-01T00:31:00.000Z");
    db.prepare("UPDATE business_users SET status='ARCHIVED' WHERE id='business-user-archived-login'").run();

    insertBusinessUser({ id: "business-user-missing-credential", email: "missing-credential@example.local" });

    insertBusinessUser({ id: "business-user-disabled-credential", email: "disabled-credential@example.local" });
    db.prepare(`INSERT INTO business_auth_credentials
      (id,user_id,credential_type,password_hash,password_hash_algorithm,password_updated_at,must_rotate_password,is_enabled,created_at,updated_at)
      VALUES ('disabled-login-credential','business-user-disabled-credential','PASSWORD_HASH',?,'scrypt.v1','created',0,0,'created','created')`).run(hashBusinessPassword(validPassword));

    for (const email of [
      "external-login@example.local",
      "suspended-login@example.local",
      "archived-login@example.local",
      "missing-credential@example.local",
      "disabled-credential@example.local"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/business-auth/login",
        payload: { email, password: validPassword }
      });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { authenticated: false, error: genericLoginError });
    }
  });

  it("treats expired, revoked, and missing sessions as unauthenticated and keeps logout idempotent", async () => {
    const expiredRawToken = "expired-raw-session-token";
    createBusinessAuthSession(db, {
      userId: "business-user-shrinika",
      sessionTokenHash: hashBusinessSessionToken(expiredRawToken),
      expiresAt: "2020-01-01T00:00:00.000Z",
      now: "2020-01-01T00:00:00.000Z"
    });

    const expired = await app.inject({
      method: "GET",
      url: "/api/business-auth/current-user",
      headers: { cookie: `shrinika_internal_session=${encodeURIComponent(expiredRawToken)}` }
    });
    assert.equal(expired.statusCode, 200);
    assert.deepEqual(expired.json(), { authenticated: false });

    const revokedRawToken = "revoked-raw-session-token";
    const revokedSession = createBusinessAuthSession(db, {
      userId: "business-user-shrinika",
      sessionTokenHash: hashBusinessSessionToken(revokedRawToken),
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-01-01T00:40:00.000Z"
    }) as { id: string };
    revokeBusinessAuthSession(db, revokedSession.id, "test revoke", "2026-01-01T00:41:00.000Z");

    const revoked = await app.inject({
      method: "GET",
      url: "/api/business-auth/current-user",
      headers: { cookie: `shrinika_internal_session=${encodeURIComponent(revokedRawToken)}` }
    });
    assert.equal(revoked.statusCode, 200);
    assert.deepEqual(revoked.json(), { authenticated: false });

    const missing = await app.inject({ method: "GET", url: "/api/business-auth/current-user" });
    assert.equal(missing.statusCode, 200);
    assert.deepEqual(missing.json(), { authenticated: false });

    const logoutMissing = await app.inject({ method: "POST", url: "/api/business-auth/logout" });
    assert.equal(logoutMissing.statusCode, 200);
    assert.deepEqual(logoutMissing.json(), { success: true });
    assert.ok(getSetCookie(logoutMissing).includes("Max-Age=0"));
  });
});
