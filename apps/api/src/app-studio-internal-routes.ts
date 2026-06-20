import type { FastifyInstance } from "fastify";
import { db } from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";

export function registerAppStudioInternalRoutes(app: FastifyInstance) {
  app.get("/api/app-studio/internal/overview", withBusinessPermission("app_studio.view", async (_request, _reply, context) => ({
    workspace: "App Studio",
    internalOnly: true,
    authenticatedUser: {
      id: context.user.id,
      displayName: context.user.displayName
    },
    counts: {
      activeProjects: countWhere("projects", "status='ACTIVE'"),
      manageableProjects: countWhere("projects", "status IN ('ACTIVE','PAUSED','ARCHIVED')"),
      agents: count("agents"),
      pendingApprovals: countWhere("approvals", "status='PENDING'")
    }
  })));

  app.get("/api/app-studio/internal/build-missions", withBusinessPermission("app_studio.create", async () => ({
    module: "build-missions",
    buildMissionCount: count("build_missions"),
    recentBuildMissions: db.prepare(`SELECT id,target_module AS targetModule,risk_level AS riskLevel,status,created_at AS createdAt
      FROM build_missions ORDER BY created_at DESC LIMIT 10`).all()
  })));

  app.get("/api/app-studio/internal/security-status", withBusinessPermission("app_studio.audit", async () => ({
    module: "security-status",
    checks: {
      permissionProfiles: count("permission_profiles"),
      deniedAccessEvents: count("denied_access_events"),
      secretRedactionEvents: count("secret_redaction_events"),
      sandboxEvents: count("sandbox_events")
    }
  })));
}

function count(table: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function countWhere(table: string, where: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count;
}
