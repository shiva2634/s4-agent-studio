import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createBusinessAuthSession,
  createBusinessSessionExpiry,
  db,
  generateBusinessSessionToken,
  getActiveBusinessAuthSession,
  hashBusinessSessionToken,
  recordBusinessAuthSecurityEvent,
  recordBusinessLoginEvent,
  revokeBusinessAuthSession,
  verifyBusinessPassword
} from "@s4/db";

export const businessSessionCookieName = "shrinika_internal_session";
const genericLoginError = "Invalid email or password";
const sessionMaxAgeSeconds = 8 * 60 * 60;

type BusinessUserRow = {
  id: string;
  email: string;
  displayName: string;
  userType: "INTERNAL" | "EXTERNAL_CLIENT";
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "ARCHIVED";
};

type BusinessCredentialRow = {
  passwordHash: string | null;
  isEnabled: number;
};

type BusinessSessionRow = {
  id: string;
  userId: string;
  expiresAt: string;
};

export function registerBusinessAuthRoutes(app: FastifyInstance) {
  app.post("/api/business-auth/login", async (request: FastifyRequest, reply) => {
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    const email = normalizeBusinessEmail(typeof body?.email === "string" ? body.email : "");
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      recordLoginFailure({ email, result: "FAILURE", reason: "Invalid login request", request });
      return reply.status(401).send({ authenticated: false, error: genericLoginError });
    }

    const user = getBusinessUserByEmail(email);
    const fail = (result: "FAILURE" | "BLOCKED", reason: string) => {
      recordLoginFailure({ email, result, reason, request, user });
      return reply.status(401).send({ authenticated: false, error: genericLoginError });
    };

    if (!user) return fail("FAILURE", "Business user not found");
    if (user.userType !== "INTERNAL") return fail("BLOCKED", "External client user attempted internal login");
    if (user.status !== "ACTIVE") return fail("BLOCKED", "Business user is not active");

    const credential = getEnabledPasswordCredential(user.id);
    if (!credential?.passwordHash || credential.isEnabled !== 1) return fail("FAILURE", "Enabled password credential missing");
    if (!verifyBusinessPassword(password, credential.passwordHash)) return fail("FAILURE", "Password verification failed");

    const timestamp = now();
    const rawSessionToken = generateBusinessSessionToken();
    const sessionTokenHash = hashBusinessSessionToken(rawSessionToken);
    const expiresAt = createBusinessSessionExpiry(new Date(timestamp));
    const session = createBusinessAuthSession(db, {
      userId: user.id,
      sessionTokenHash,
      expiresAt,
      ipAddressHash: null,
      userAgentHash: hashHeaderValue(request.headers["user-agent"]),
      metadata: { route: "/api/business-auth/login", result: "SUCCESS" },
      now: timestamp
    }) as BusinessSessionRow;

    recordBusinessLoginEvent(db, {
      userId: user.id,
      email,
      userType: user.userType,
      result: "SUCCESS",
      reason: "Internal login succeeded",
      userAgentHash: hashHeaderValue(request.headers["user-agent"]),
      metadata: { route: "/api/business-auth/login", result: "SUCCESS" },
      now: timestamp
    });

    setSessionCookie(reply, rawSessionToken);
    return {
      authenticated: true,
      user: getSanitizedBusinessUser(user.id),
      session: {
        expiresAt: session.expiresAt
      }
    };
  });

  app.post("/api/business-auth/logout", async (request, reply) => {
    const rawSessionToken = parseSessionCookie(request);
    if (rawSessionToken) {
      const session = getActiveBusinessAuthSession(db, hashBusinessSessionToken(rawSessionToken), now()) as BusinessSessionRow | undefined;
      if (session) {
        const timestamp = now();
        revokeBusinessAuthSession(db, session.id, "User logout", timestamp);
        recordBusinessAuthSecurityEvent(db, {
          userId: session.userId,
          eventType: "logout",
          severity: "low",
          description: "Internal session logout",
          metadata: { route: "/api/business-auth/logout", result: "SUCCESS" },
          now: timestamp
        });
      }
    }
    clearSessionCookie(reply);
    return { success: true };
  });

  app.get("/api/business-auth/current-user", async (request) => {
    const context = getCurrentBusinessAuthContext(request);
    if (!context) return { authenticated: false };
    return {
      authenticated: true,
      user: context.user,
      session: {
        expiresAt: context.session.expiresAt
      }
    };
  });
}

export function getCurrentBusinessAuthContext(request: FastifyRequest) {
  const rawSessionToken = parseSessionCookie(request);
  if (!rawSessionToken) return null;
  const session = getActiveBusinessAuthSession(db, hashBusinessSessionToken(rawSessionToken), now()) as BusinessSessionRow | undefined;
  if (!session) return null;
  const user = getSanitizedBusinessUser(session.userId);
  if (!user || user.userType !== "INTERNAL" || user.status !== "ACTIVE") return null;
  return { user, session };
}

export function parseSessionCookie(request: FastifyRequest) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  for (const part of cookies.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName === businessSessionCookieName) {
      const value = rawValueParts.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function setSessionCookie(reply: FastifyReply, rawSessionToken: string) {
  reply.header("Set-Cookie", serializeCookie(businessSessionCookieName, rawSessionToken, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  }));
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", serializeCookie(businessSessionCookieName, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  }));
}

function getBusinessUserByEmail(email: string) {
  return db.prepare(`SELECT id,email,display_name AS displayName,user_type AS userType,status
    FROM business_users WHERE email=? COLLATE NOCASE LIMIT 1`).get(email) as BusinessUserRow | undefined;
}

function getEnabledPasswordCredential(userId: string) {
  return db.prepare(`SELECT password_hash AS passwordHash,is_enabled AS isEnabled
    FROM business_auth_credentials
    WHERE user_id=? AND credential_type='PASSWORD_HASH' AND is_enabled=1
    LIMIT 1`).get(userId) as BusinessCredentialRow | undefined;
}

function getSanitizedBusinessUser(userId: string) {
  const user = db.prepare(`SELECT id,email,display_name AS displayName,user_type AS userType,status
    FROM business_users WHERE id=?`).get(userId) as BusinessUserRow | undefined;
  if (!user) return null;
  const roles = db.prepare(`SELECT r.role_key AS roleKey
    FROM business_user_roles ur
    JOIN business_roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND ur.revoked_at IS NULL
    ORDER BY r.role_key`).all(user.id) as Array<{ roleKey: string }>;
  const permissions = db.prepare(`SELECT DISTINCT p.permission_key AS permissionKey
    FROM business_user_roles ur
    JOIN business_role_permissions rp ON rp.role_id=ur.role_id
    JOIN business_permissions p ON p.id=rp.permission_id
    WHERE ur.user_id=? AND ur.revoked_at IS NULL
    ORDER BY p.permission_key`).all(user.id) as Array<{ permissionKey: string }>;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    userType: user.userType,
    status: user.status,
    roles: roles.map((role) => role.roleKey),
    permissions: permissions.map((permission) => permission.permissionKey)
  };
}

function recordLoginFailure(input: { email: string; result: "FAILURE" | "BLOCKED"; reason: string; request: FastifyRequest; user?: BusinessUserRow }) {
  recordBusinessLoginEvent(db, {
    userId: input.user?.id ?? null,
    email: input.email || null,
    userType: input.user?.userType ?? null,
    result: input.result,
    reason: input.reason,
    userAgentHash: hashHeaderValue(input.request.headers["user-agent"]),
    metadata: { route: "/api/business-auth/login", result: input.result, reason: input.reason },
    now: now()
  });
}

function serializeCookie(name: string, value: string, options: { httpOnly: boolean; sameSite: "Lax" | "Strict"; secure: boolean; path: string; maxAge: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${options.maxAge}`, `Path=${options.path}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function normalizeBusinessEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join(" ") : value;
  if (!raw) return null;
  return hashBusinessSessionToken(raw);
}

function now() {
  return new Date().toISOString();
}
