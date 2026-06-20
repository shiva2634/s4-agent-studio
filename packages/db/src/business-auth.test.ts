import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  assertSafeBusinessPassword,
  createBusinessPasswordResetExpiry,
  createBusinessSessionExpiry,
  generateBusinessPasswordResetToken,
  generateBusinessSessionToken,
  hashBusinessPassword,
  hashBusinessPasswordResetToken,
  hashBusinessSessionToken,
  identifyBusinessPasswordAlgorithm,
  isBusinessSessionExpired,
  redactBusinessAuthSecret,
  sanitizeBusinessAuthMetadata,
  setBusinessUserPasswordCredential,
  verifyBusinessPassword
} from "./business-auth.js";

async function loadInitializer() {
  return await import("./index.js");
}

describe("Business Control Centre auth utilities", () => {
  it("hashes and verifies passwords without returning raw passwords", () => {
    const password = "CorrectHorseBatteryStaple!2026";
    const firstHash = hashBusinessPassword(password);
    const secondHash = hashBusinessPassword(password);

    assert.notEqual(firstHash, password);
    assert.notEqual(secondHash, password);
    assert.notEqual(firstHash, secondHash);
    assert.equal(identifyBusinessPasswordAlgorithm(firstHash), "scrypt.v1");
    assert.equal(verifyBusinessPassword(password, firstHash), true);
    assert.equal(verifyBusinessPassword("WrongHorseBatteryStaple!2026", firstHash), false);
    assert.equal(verifyBusinessPassword(password, "not-a-valid-hash"), false);
  });

  it("rejects empty and weak business passwords", () => {
    assert.throws(() => assertSafeBusinessPassword(""), /at least 12 characters/);
    assert.throws(() => hashBusinessPassword("too-short"), /at least 12 characters/);
    assert.throws(() => hashBusinessPassword("  padded-secret-2026  "), /leading or trailing whitespace/);
  });

  it("generates high-entropy tokens and deterministic token hashes", () => {
    const firstSessionToken = generateBusinessSessionToken();
    const secondSessionToken = generateBusinessSessionToken();
    assert.notEqual(firstSessionToken, secondSessionToken);
    assert.ok(firstSessionToken.length >= 40);

    const firstSessionHash = hashBusinessSessionToken(firstSessionToken);
    const secondSessionHash = hashBusinessSessionToken(firstSessionToken);
    assert.equal(firstSessionHash, secondSessionHash);
    assert.notEqual(firstSessionHash, firstSessionToken);
    assert.ok(firstSessionHash.startsWith("sha256$"));

    const resetToken = generateBusinessPasswordResetToken();
    const resetHash = hashBusinessPasswordResetToken(resetToken);
    assert.equal(resetHash, hashBusinessPasswordResetToken(resetToken));
    assert.notEqual(resetHash, resetToken);
    assert.ok(resetHash.startsWith("sha256$"));
  });

  it("creates and checks auth expiry timestamps", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    assert.equal(createBusinessSessionExpiry(now), "2026-01-01T08:00:00.000Z");
    assert.equal(isBusinessSessionExpired("2026-01-01T08:00:00.000Z", new Date("2026-01-01T07:59:59.000Z")), false);
    assert.equal(isBusinessSessionExpired("2026-01-01T08:00:00.000Z", new Date("2026-01-01T08:00:00.000Z")), true);
    assert.equal(isBusinessSessionExpired("not-a-date", now), true);
    assert.equal(createBusinessPasswordResetExpiry(now), "2026-01-01T00:30:00.000Z");
  });

  it("redacts auth metadata keys and secret-looking values", () => {
    assert.equal(redactBusinessAuthSecret("Bearer hidden-token-value"), "[redacted]");
    assert.equal(redactBusinessAuthSecret("safe route note"), "safe route note");

    const metadata = sanitizeBusinessAuthMetadata({
      route: "/business-control-centre",
      reason: "login blocked",
      result: "BLOCKED",
      password: "raw-password",
      token: "raw-token",
      secret: "raw-secret",
      apiKey: "sk-test-secret-value",
      authorization: "Bearer hidden-token-value",
      cookie: "session=hidden-cookie",
      session: "hidden-session",
      credential: "hidden-credential",
      note: "safe note",
      nested: { token: "inside-object" },
      values: ["safe", "token=hidden-array-token"]
    });

    assert.equal(metadata.route, "/business-control-centre");
    assert.equal(metadata.reason, "login blocked");
    assert.equal(metadata.result, "BLOCKED");
    assert.equal(metadata.note, "safe note");
    assert.equal(metadata.password, "[redacted]");
    assert.equal(metadata.token, "[redacted]");
    assert.equal(metadata.secret, "[redacted]");
    assert.equal(metadata.apiKey, "[redacted]");
    assert.equal(metadata.authorization, "[redacted]");
    assert.equal(metadata.cookie, "[redacted]");
    assert.equal(metadata.session, "[redacted]");
    assert.equal(metadata.credential, "[redacted]");
    assert.equal(metadata.nested, "[object redacted]");
    assert.deepEqual(metadata.values, ["safe", "[redacted]"]);
  });

  it("sets password credentials only for active internal users and stores hashes only", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const password = "InternalPassword!2026";
      const credential = setBusinessUserPasswordCredential(db, "business-user-shrinika", password, "2026-01-01T00:00:00.000Z") as {
        id: string;
        passwordHash: string;
        passwordHashAlgorithm: string;
        isEnabled: number;
      };

      assert.equal(credential.isEnabled, 1);
      assert.equal(credential.passwordHashAlgorithm, "scrypt.v1");
      assert.notEqual(credential.passwordHash, password);
      assert.equal(verifyBusinessPassword(password, credential.passwordHash), true);

      const secondCredential = setBusinessUserPasswordCredential(db, "business-user-shrinika", "InternalPassword!2027", "2026-01-01T00:01:00.000Z") as {
        id: string;
        passwordHash: string;
        isEnabled: number;
      };
      assert.notEqual(secondCredential.id, credential.id);
      assert.equal(secondCredential.isEnabled, 1);
      assert.equal(verifyBusinessPassword("InternalPassword!2027", secondCredential.passwordHash), true);

      const activeCount = db.prepare(`SELECT COUNT(*) AS count
        FROM business_auth_credentials
        WHERE user_id='business-user-shrinika' AND credential_type='PASSWORD_HASH' AND is_enabled=1`).get() as { count: number };
      assert.equal(activeCount.count, 1);

      const storedRawPasswordCount = db.prepare("SELECT COUNT(*) AS count FROM business_auth_credentials WHERE password_hash=?").get(password) as { count: number };
      assert.equal(storedRawPasswordCount.count, 0);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-client-password','client-password@example.local','Client Password','EXTERNAL_CLIENT','ACTIVE','created','created')`).run();
      assert.throws(() => setBusinessUserPasswordCredential(db, "business-user-client-password", "ExternalPassword!2026"), /External client users cannot receive internal password credentials/);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-suspended-password','suspended-password@example.local','Suspended Password','INTERNAL','SUSPENDED','created','created')`).run();
      assert.throws(() => setBusinessUserPasswordCredential(db, "business-user-suspended-password", "SuspendedPassword!2026"), /Business user is not active/);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-archived-password','archived-password@example.local','Archived Password','INTERNAL','ARCHIVED','created','created')`).run();
      assert.throws(() => setBusinessUserPasswordCredential(db, "business-user-archived-password", "ArchivedPassword!2026"), /Business user is not active/);
    } finally {
      db.close();
    }
  });
});
