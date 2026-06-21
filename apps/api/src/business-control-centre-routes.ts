import type { FastifyInstance } from "fastify";
import { db } from "@s4/db";
import { withBusinessPermission } from "./business-auth-middleware.js";
import { buildDeploymentHardeningStatus } from "./deployment-hardening.js";

export function registerBusinessControlCentreRoutes(app: FastifyInstance) {
  app.get("/api/business-control-centre/overview", withBusinessPermission("company.view", async (_request, _reply, context) => ({
    workspace: "Business Control Centre",
    company: "Shrinika Technologies",
    internalOnly: true,
    authenticatedUser: {
      id: context.user.id,
      displayName: context.user.displayName
    },
    counts: {
      businessUsers: count("business_users"),
      activeInternalUsers: countWhere("business_users", "user_type='INTERNAL' AND status='ACTIVE'"),
      roles: count("business_roles"),
      permissions: count("business_permissions")
    }
  })));

  app.get("/api/business-control-centre/audit", withBusinessPermission("audit.view", async () => ({
    module: "audit",
    auditEventCount: count("audit_events"),
    deniedAccessEventCount: count("denied_access_events"),
    recentDeniedAccessEvents: db.prepare(`SELECT attempted_module AS attemptedModule,attempted_action AS attemptedAction,reason,created_at AS createdAt
      FROM denied_access_events ORDER BY created_at DESC LIMIT 10`).all()
  })));

  app.get("/api/business-control-centre/approvals", withBusinessPermission("projects.approve", async () => ({
    module: "approvals",
    pendingApprovalCount: countWhere("approvals", "status='PENDING'"),
    recentApprovals: db.prepare(`SELECT id,action_type AS actionType,risk_level AS riskLevel,status,created_at AS createdAt
      FROM approvals ORDER BY created_at DESC LIMIT 10`).all()
  })));

  app.get("/api/business-control-centre/system-health", withBusinessPermission("system.view", async () => ({
    module: "system-health",
    status: "placeholder-healthy",
    checks: {
      database: "connected",
      authTables: "ready",
      rbac: "ready",
      protectedInternalRoutes: "enabled"
    }
  })));

  app.get("/api/business-control-centre/deployment-hardening-status", withBusinessPermission("system.view", async () => ({
    module: "deployment-hardening",
    ...buildDeploymentHardeningStatus(process.env)
  })));

  app.get("/api/business-control-centre/internal-smoke-test-status", withBusinessPermission("system.view", async () => ({
    module: "internal-smoke-test",
    command: "npm run internal:smoke",
    docsPath: "docs/final-internal-deployment-smoke-test.md",
    status: "manual-run-required",
    summary: "Read-only smoke validation is available. Deployment still requires explicit manual approval.",
    deploymentRequiresManualApproval: true
  })));
}

function count(table: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function countWhere(table: string, where: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count;
}
