import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import {
  db,
  getActiveBusinessAuthSession,
  hashBusinessSessionToken,
  recordDeniedAccessEvent,
  userHasBusinessPermission
} from "@s4/db";
import { parseSessionCookie } from "./business-auth.js";

type BusinessUserType = "INTERNAL" | "EXTERNAL_CLIENT";
type BusinessUserStatus = "ACTIVE" | "INVITED" | "SUSPENDED" | "ARCHIVED";

type BusinessAuthUser = {
  id: string;
  email: string;
  displayName: string;
  userType: BusinessUserType;
  status: BusinessUserStatus;
  roles: string[];
  permissions: string[];
};

type BusinessAuthSession = {
  id: string;
  userId: string;
  expiresAt: string;
};

export type BusinessAuthContext = {
  user: BusinessAuthUser;
  session: BusinessAuthSession;
};

type PermissionInput = string | { module: string; action: string };

type AnySessionRow = {
  id: string;
  userId: string;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  revokedAt: string | null;
  userType: BusinessUserType;
  userStatus: BusinessUserStatus;
};

export function getBusinessAuthContext(request: FastifyRequest): BusinessAuthContext | null {
  const rawSessionToken = parseSessionCookie(request);
  if (!rawSessionToken) return null;
  const session = getActiveBusinessAuthSession(db, hashBusinessSessionToken(rawSessionToken), now()) as BusinessAuthSession | undefined;
  if (!session) return null;
  const user = getSanitizedBusinessAuthUser(session.userId);
  if (!user || user.userType !== "INTERNAL" || user.status !== "ACTIVE") return null;
  return { user, session };
}

export function requireBusinessSession(request: FastifyRequest, reply: FastifyReply): BusinessAuthContext | null {
  const context = getBusinessAuthContext(request);
  if (!context) {
    recordDenied(request, {
      attemptedModule: "auth",
      attemptedAction: "session",
      reason: "Valid internal business session required"
    });
    buildBusinessAuthFailureResponse(reply, 401);
    return null;
  }
  return context;
}

export function requireInternalUser(request: FastifyRequest, reply: FastifyReply): BusinessAuthContext | null {
  const context = getBusinessAuthContext(request);
  if (context) return context;

  const session = getAnyBusinessSessionFromRequest(request);
  if (!session || session.status !== "ACTIVE" || session.revokedAt || session.expiresAt <= now()) {
    recordDenied(request, {
      attemptedModule: "auth",
      attemptedAction: "internal_user",
      reason: "Active internal user session required",
      userId: session?.userId ?? null,
      userType: session?.userType ?? null
    });
    buildBusinessAuthFailureResponse(reply, 401);
    return null;
  }

  recordDenied(request, {
    attemptedModule: "auth",
    attemptedAction: "internal_user",
    reason: "Session user is not allowed for internal access",
    userId: session.userId,
    userType: session.userType
  });
  buildBusinessAuthFailureResponse(reply, 403);
  return null;
}

export function requireBusinessPermission(request: FastifyRequest, reply: FastifyReply, permission: PermissionInput): BusinessAuthContext | null {
  const context = requireInternalUser(request, reply);
  if (!context) return null;
  const { permissionKey, module, action } = normalizePermissionInput(permission);
  if (!userHasBusinessPermission(db, context.user.id, permissionKey)) {
    recordDenied(request, {
      attemptedModule: module,
      attemptedAction: action,
      reason: "Business permission required",
      userId: context.user.id,
      userType: context.user.userType
    });
    buildBusinessAuthFailureResponse(reply, 403);
    return null;
  }
  return context;
}

export function requireBusinessRole(request: FastifyRequest, reply: FastifyReply, roleKey: string): BusinessAuthContext | null {
  const context = requireInternalUser(request, reply);
  if (!context) return null;
  const row = db.prepare(`SELECT ur.id
    FROM business_user_roles ur
    JOIN business_roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND r.role_key=? AND ur.revoked_at IS NULL
    LIMIT 1`).get(context.user.id, roleKey) as { id: string } | undefined;
  if (!row) {
    recordDenied(request, {
      attemptedModule: "role",
      attemptedAction: roleKey,
      reason: "Business role required",
      userId: context.user.id,
      userType: context.user.userType
    });
    buildBusinessAuthFailureResponse(reply, 403);
    return null;
  }
  return context;
}

export function buildBusinessAuthFailureResponse(reply: FastifyReply, statusCode: 401 | 403) {
  return reply.status(statusCode).send({
    authenticated: false,
    error: statusCode === 401 ? "Unauthenticated" : "Forbidden"
  });
}

export function withBusinessPermission(permission: PermissionInput, handler: (request: FastifyRequest, reply: FastifyReply, context: BusinessAuthContext) => ReturnType<RouteHandlerMethod>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const context = requireBusinessPermission(request, reply, permission);
    if (!context) return;
    return handler(request, reply, context);
  };
}

function getAnyBusinessSessionFromRequest(request: FastifyRequest) {
  const rawSessionToken = parseSessionCookie(request);
  if (!rawSessionToken) return null;
  return db.prepare(`SELECT s.id,s.user_id AS userId,s.expires_at AS expiresAt,s.status,s.revoked_at AS revokedAt,
      u.user_type AS userType,u.status AS userStatus
    FROM business_auth_sessions s
    JOIN business_users u ON u.id=s.user_id
    WHERE s.session_token_hash=?
    LIMIT 1`).get(hashBusinessSessionToken(rawSessionToken)) as AnySessionRow | undefined ?? null;
}

function getSanitizedBusinessAuthUser(userId: string): BusinessAuthUser | null {
  const user = db.prepare(`SELECT id,email,display_name AS displayName,user_type AS userType,status
    FROM business_users WHERE id=?`).get(userId) as Omit<BusinessAuthUser, "roles" | "permissions"> | undefined;
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
    ...user,
    roles: roles.map((role) => role.roleKey),
    permissions: permissions.map((permission) => permission.permissionKey)
  };
}

function normalizePermissionInput(permission: PermissionInput) {
  if (typeof permission === "string") {
    const [module, action] = permission.split(".");
    return {
      permissionKey: permission,
      module: module || "unknown",
      action: action || "unknown"
    };
  }
  return {
    permissionKey: `${permission.module}.${permission.action}`,
    module: permission.module,
    action: permission.action
  };
}

function recordDenied(request: FastifyRequest, input: { attemptedModule: string; attemptedAction: string; reason: string; userId?: string | null; userType?: string | null }) {
  recordDeniedAccessEvent(db, {
    userId: input.userId ?? null,
    userType: input.userType ?? null,
    attemptedModule: input.attemptedModule,
    attemptedAction: input.attemptedAction,
    reason: input.reason,
    metadata: {
      route: request.url,
      method: request.method
    },
    now: now()
  });
}

function now() {
  return new Date().toISOString();
}
