import Database from "better-sqlite3";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const BUSINESS_PASSWORD_MIN_LENGTH = 12;
export const BUSINESS_SESSION_EXPIRY_HOURS = 8;
export const BUSINESS_PASSWORD_RESET_EXPIRY_MINUTES = 30;

const SCRYPT_VERSION = "v1";
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024
};

type BusinessUserType = "INTERNAL" | "EXTERNAL_CLIENT";
type BusinessUserStatus = "ACTIVE" | "INVITED" | "SUSPENDED" | "ARCHIVED";

export function assertSafeBusinessPassword(password: string) {
  if (typeof password !== "string") throw new Error("Password must be a string");
  if (password.length < BUSINESS_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${BUSINESS_PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.trim().length !== password.length || password.trim().length < BUSINESS_PASSWORD_MIN_LENGTH) {
    throw new Error("Password must not rely on leading or trailing whitespace");
  }
}

export function hashBusinessPassword(password: string) {
  assertSafeBusinessPassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem
  });
  return [
    "scrypt",
    SCRYPT_VERSION,
    `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p},keylen=${SCRYPT_PARAMS.keylen}`,
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join("$");
}

export function verifyBusinessPassword(password: string, storedHash: string) {
  try {
    const parsed = parseScryptPasswordHash(storedHash);
    const candidate = scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_PARAMS.maxmem
    });
    return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
  } catch {
    return false;
  }
}

export function identifyBusinessPasswordAlgorithm(storedHash: string) {
  const [algorithm, version] = storedHash.split("$");
  if (algorithm === "scrypt" && version) return `${algorithm}.${version}`;
  return "unknown";
}

export function generateBusinessSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashBusinessSessionToken(rawToken: string) {
  return hashBusinessToken(rawToken);
}

export function generateBusinessPasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashBusinessPasswordResetToken(rawToken: string) {
  return hashBusinessToken(rawToken);
}

export function createBusinessSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + BUSINESS_SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}

export function isBusinessSessionExpired(expiresAt: string, now = new Date()) {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return true;
  return expires <= now.getTime();
}

export function createBusinessPasswordResetExpiry(now = new Date()) {
  return new Date(now.getTime() + BUSINESS_PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

export function redactBusinessAuthSecret(value: string) {
  if (looksSensitive(value)) return "[redacted]";
  return value.slice(0, 500);
}

export function sanitizeBusinessAuthMetadata(metadata: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) {
      clean[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      clean[key] = redactBusinessAuthSecret(value);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = value.slice(0, 20).map((item) => {
        if (typeof item === "string") return redactBusinessAuthSecret(item).slice(0, 200);
        if (typeof item === "number" || typeof item === "boolean" || item === null) return item;
        return "[object redacted]";
      });
    } else {
      clean[key] = "[object redacted]";
    }
  }
  return clean;
}

export function setBusinessUserPasswordCredential(database: Database.Database, userId: string, password: string, now = new Date().toISOString()) {
  const user = database.prepare("SELECT id,user_type AS userType,status FROM business_users WHERE id=?").get(userId) as { id: string; userType: BusinessUserType; status: BusinessUserStatus } | undefined;
  if (!user) throw new Error("Business user not found");
  if (user.userType !== "INTERNAL") throw new Error("External client users cannot receive internal password credentials");
  if (user.status !== "ACTIVE") throw new Error("Business user is not active for password credentials");

  const passwordHash = hashBusinessPassword(password);
  const credentialId = `business-auth-credential-${user.id}-${now.replace(/[^0-9A-Za-z]/g, "")}-${randomBytes(4).toString("hex")}`;

  const transaction = database.transaction(() => {
    database.prepare(`UPDATE business_auth_credentials
      SET is_enabled=0,updated_at=?
      WHERE user_id=? AND credential_type='PASSWORD_HASH' AND is_enabled=1`).run(now, user.id);
    database.prepare(`INSERT INTO business_auth_credentials
      (id,user_id,credential_type,password_hash,password_hash_algorithm,password_updated_at,must_rotate_password,is_enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      credentialId,
      user.id,
      "PASSWORD_HASH",
      passwordHash,
      identifyBusinessPasswordAlgorithm(passwordHash),
      now,
      0,
      1,
      now,
      now
    );
  });
  transaction();

  return database.prepare(`SELECT id,user_id AS userId,credential_type AS credentialType,password_hash AS passwordHash,
      password_hash_algorithm AS passwordHashAlgorithm,password_updated_at AS passwordUpdatedAt,
      must_rotate_password AS mustRotatePassword,is_enabled AS isEnabled,created_at AS createdAt,updated_at AS updatedAt
    FROM business_auth_credentials WHERE id=?`).get(credentialId);
}

function hashBusinessToken(rawToken: string) {
  if (!rawToken || typeof rawToken !== "string") throw new Error("Token must be a non-empty string");
  return `sha256$${createHash("sha256").update(rawToken, "utf8").digest("base64url")}`;
}

function parseScryptPasswordHash(storedHash: string) {
  const [algorithm, version, paramsText, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || version !== SCRYPT_VERSION || !paramsText || !saltText || !hashText) {
    throw new Error("Unsupported password hash format");
  }
  const params = Object.fromEntries(paramsText.split(",").map((entry) => {
    const [key, value] = entry.split("=");
    return [key, Number(value)];
  }));
  if (params.N !== SCRYPT_PARAMS.N || params.r !== SCRYPT_PARAMS.r || params.p !== SCRYPT_PARAMS.p || params.keylen !== SCRYPT_PARAMS.keylen) {
    throw new Error("Unsupported scrypt parameters");
  }
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length < 16 || hash.length !== SCRYPT_PARAMS.keylen) throw new Error("Invalid password hash payload");
  return {
    N: params.N,
    r: params.r,
    p: params.p,
    salt,
    hash
  };
}

function isSensitiveMetadataKey(key: string) {
  return /secret|token|api[_-]?key|password|credential|authorization|cookie|session/i.test(key);
}

function looksSensitive(value: string) {
  return /(sk-[A-Za-z0-9_-]{12,}|api[_-]?key|password|bearer\s+|secret|token=|authorization:|session=|cookie=)/i.test(value);
}
