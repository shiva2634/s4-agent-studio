import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { verifyBusinessPassword } from "./business-auth.js";
import { formatInternalCredentialSetupSummary, setSeededInternalUserPassword } from "./internal-credential-setup.js";

async function loadInitializer() {
  return await import("./index.js");
}

describe("internal credential setup", () => {
  it("activates password credentials for seeded Shrinika and Shiva users", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const ownerPassword = "OwnerInternalPassword!2026";
      const guardianPassword = "GuardianInternalPassword!2026";
      const ownerSummary = setSeededInternalUserPassword(db, {
        email: "owner@shrinika.local",
        password: ownerPassword,
        now: "2026-01-01T00:00:00.000Z"
      });
      const guardianSummary = setSeededInternalUserPassword(db, {
        email: "shiva@shrinika.local",
        password: guardianPassword,
        now: "2026-01-01T00:01:00.000Z"
      });

      assert.equal(ownerSummary.displayName, "Shrinika");
      assert.deepEqual(ownerSummary.roleKeys, ["main_admin_owner"]);
      assert.equal(ownerSummary.credentialStatus, "activated");
      assert.equal(guardianSummary.displayName, "Shiva");
      assert.deepEqual(guardianSummary.roleKeys, ["system_guardian"]);

      const ownerCredential = db.prepare(`SELECT password_hash AS passwordHash,is_enabled AS isEnabled
        FROM business_auth_credentials
        WHERE user_id='business-user-shrinika' AND credential_type='PASSWORD_HASH' AND is_enabled=1`).get() as { passwordHash: string; isEnabled: number };
      const guardianCredential = db.prepare(`SELECT password_hash AS passwordHash,is_enabled AS isEnabled
        FROM business_auth_credentials
        WHERE user_id='business-user-shiva' AND credential_type='PASSWORD_HASH' AND is_enabled=1`).get() as { passwordHash: string; isEnabled: number };

      assert.equal(ownerCredential.isEnabled, 1);
      assert.equal(guardianCredential.isEnabled, 1);
      assert.notEqual(ownerCredential.passwordHash, ownerPassword);
      assert.notEqual(guardianCredential.passwordHash, guardianPassword);
      assert.equal(verifyBusinessPassword(ownerPassword, ownerCredential.passwordHash), true);
      assert.equal(verifyBusinessPassword(guardianPassword, guardianCredential.passwordHash), true);
    } finally {
      db.close();
    }
  });

  it("rotates credentials and disables the previous active password", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const firstPassword = "OwnerInternalPassword!2026";
      const secondPassword = "OwnerInternalPassword!2027";
      setSeededInternalUserPassword(db, { email: "OWNER@SHRINIKA.LOCAL", password: firstPassword, now: "2026-01-01T00:00:00.000Z" });
      setSeededInternalUserPassword(db, { email: "owner@shrinika.local", password: secondPassword, now: "2026-01-01T00:02:00.000Z" });

      const credentials = db.prepare(`SELECT password_hash AS passwordHash,is_enabled AS isEnabled
        FROM business_auth_credentials
        WHERE user_id='business-user-shrinika' AND credential_type='PASSWORD_HASH'
        ORDER BY created_at`).all() as Array<{ passwordHash: string | null; isEnabled: number }>;
      const activeCredentials = credentials.filter((credential) => credential.isEnabled === 1);
      assert.equal(activeCredentials.length, 1);
      assert.equal(verifyBusinessPassword(secondPassword, activeCredentials[0]?.passwordHash ?? ""), true);
      assert.equal(verifyBusinessPassword(firstPassword, activeCredentials[0]?.passwordHash ?? ""), false);
    } finally {
      db.close();
    }
  });

  it("rejects external, inactive, unknown, non-seeded, and weak password setup attempts", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-client-setup','client-setup@example.local','Client Setup','EXTERNAL_CLIENT','ACTIVE','created','created')`).run();
      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-manager-setup','manager-setup@example.local','Manager Setup','INTERNAL','ACTIVE','created','created')`).run();

      assert.throws(() => setSeededInternalUserPassword(db, { email: "missing@example.local", password: "MissingPassword!2026" }), /Business user not found/);
      assert.throws(() => setSeededInternalUserPassword(db, { email: "client-setup@example.local", password: "ClientPassword!2026" }), /Only seeded Shrinika and Shiva/);
      assert.throws(() => setSeededInternalUserPassword(db, { email: "manager-setup@example.local", password: "ManagerPassword!2026" }), /Only seeded Shrinika and Shiva/);
      assert.throws(() => setSeededInternalUserPassword(db, { email: "owner@shrinika.local", password: "too-short" }), /at least 12 characters/);

      db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shiva'").run();
      assert.throws(() => setSeededInternalUserPassword(db, { email: "shiva@shrinika.local", password: "SuspendedPassword!2026" }), /Business user is not active/);
      db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shiva'").run();
      db.prepare("UPDATE business_users SET status='ARCHIVED' WHERE id='business-user-shiva'").run();
      assert.throws(() => setSeededInternalUserPassword(db, { email: "shiva@shrinika.local", password: "ArchivedPassword!2026" }), /Business user is not active/);
    } finally {
      db.close();
    }
  });

  it("formats CLI-safe output without raw passwords, hashes, or credential identifiers", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const password = "OwnerInternalPassword!2026";
      const summary = setSeededInternalUserPassword(db, { email: "owner@shrinika.local", password, now: "2026-01-01T00:00:00.000Z" });
      const stored = db.prepare(`SELECT password_hash AS passwordHash FROM business_auth_credentials WHERE id=?`).get(summary.credentialId) as { passwordHash: string };
      const output = formatInternalCredentialSetupSummary(summary);

      assert.ok(output.includes("owner@shrinika.local"));
      assert.ok(output.includes("Shrinika"));
      assert.ok(output.includes("main_admin_owner"));
      assert.ok(!output.includes(password));
      assert.ok(!output.includes(stored.passwordHash));
      assert.ok(!output.includes(summary.credentialId));
    } finally {
      db.close();
    }
  });
});
