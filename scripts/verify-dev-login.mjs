import {
  db,
  getResolvedDatabasePath,
  INTERNAL_DEV_DEFAULT_CREDENTIALS,
  verifyBusinessPassword
} from "@s4/db";

const databasePath = getResolvedDatabasePath();

function fail(message) {
  console.error(message);
  db.close();
  process.exit(1);
}

function getSeededUser(email) {
  return db.prepare(`SELECT id,email,display_name AS displayName,user_type AS userType,status
    FROM business_users
    WHERE email=? COLLATE NOCASE`).get(email);
}

function getActivePasswordCredential(userId) {
  return db.prepare(`SELECT password_hash AS passwordHash,is_enabled AS isEnabled
    FROM business_auth_credentials
    WHERE user_id=? AND credential_type='PASSWORD_HASH' AND is_enabled=1
    ORDER BY created_at DESC
    LIMIT 1`).get(userId);
}

console.log(`Using database: ${databasePath}`);

for (const credential of INTERNAL_DEV_DEFAULT_CREDENTIALS) {
  const user = getSeededUser(credential.email);
  if (!user) fail(`Seeded internal user is missing: ${credential.email}`);
  if (user.userType !== "INTERNAL") fail(`Seeded user is not internal: ${credential.email}`);
  if (user.status !== "ACTIVE") fail(`Seeded user is not active: ${credential.email}`);

  const storedCredential = getActivePasswordCredential(user.id);
  if (!storedCredential?.passwordHash || storedCredential.isEnabled !== 1) {
    fail(`Active password credential is missing: ${credential.email}`);
  }
  if (storedCredential.passwordHash === credential.password) {
    fail(`Stored password credential is not hashed: ${credential.email}`);
  }
  if (!storedCredential.passwordHash.startsWith("scrypt$")) {
    fail(`Stored password credential does not use the expected hash format: ${credential.email}`);
  }
  if (!verifyBusinessPassword(credential.password, storedCredential.passwordHash)) {
    fail(`Development password does not verify for: ${credential.email}`);
  }

  console.log(`Verified ${user.displayName} <${user.email}>: active internal user, active password credential, dev password verifies.`);
}

console.log("Internal dev login credentials verify locally.");
db.close();
