import type Database from "better-sqlite3";
import path from "node:path";
import { nanoid } from "nanoid";
import { isSecretPath, validateProposalPath } from "./change-proposals.js";

export type PermissionAction =
  | "FILE_READ"
  | "FILE_PROPOSAL"
  | "PROPOSAL_APPLY"
  | "COMMAND"
  | "SCAFFOLD_PROPOSAL"
  | "SPECIALIST_ACTION"
  | "ROLLBACK"
  | "RECOVERY"
  | "PROVIDER_CALL"
  | "NETWORK_ACCESS"
  | "SECRET_ACCESS";

export type PermissionDecision = "ALLOW" | "DENY" | "APPROVAL_REQUIRED";
export type CommandRiskClass = "safe-read-only" | "test-check" | "build-typecheck" | "package-install" | "migration-database" | "filesystem-mutation" | "network" | "destructive";

export class PermissionDeniedError extends Error {
  constructor(message: string, readonly decision: PermissionDecision = "DENY") {
    super(message);
  }
}

export type PolicyAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown }) => void;

const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi,
  /(?:secret|token|password|credential)["']?\s*[:=]\s*["']?[^"',\s]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}/g
];

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function hasColumn(db: Database.Database, table: string, column: string) {
  if (!hasTable(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function projectRow(db: Database.Database, projectId: string) {
  if (!hasTable(db, "projects")) return undefined;
  const hasName = hasColumn(db, "projects", "name");
  const hasStatus = hasColumn(db, "projects", "status");
  const hasPermissionProfile = hasColumn(db, "projects", "permission_profile_id");
  return db.prepare(`SELECT id,${hasName ? "name" : "id AS name"},root_path AS rootPath,${hasStatus ? "status" : "'ACTIVE' AS status"},${hasPermissionProfile ? "permission_profile_id AS permissionProfileId" : "'standard-governed' AS permissionProfileId"} FROM projects WHERE id=?`).get(projectId) as { id: string; name: string; rootPath: string; status: string; permissionProfileId?: string } | undefined;
}

export function redactSecrets(value: string) {
  let redacted = value;
  let count = 0;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, () => {
      count += 1;
      return "[redacted]";
    });
  }
  return { value: redacted, redacted: count > 0, count };
}

export function recordSecretRedaction(db: Database.Database, input: { projectId?: string | null; taskId?: string | null; source: string; count: number; now: string; audit?: PolicyAuditWriter }) {
  if (!input.count || !hasTable(db, "secret_redaction_events")) return;
  db.prepare("INSERT INTO secret_redaction_events (id,project_id,task_id,source,pattern_count,created_at) VALUES (?,?,?,?,?,?)")
    .run(nanoid(), input.projectId ?? null, input.taskId ?? null, input.source, input.count, input.now);
  input.audit?.("SECRET_REDACTION_PERFORMED", "Secret-like output was redacted", { projectId: input.projectId ?? undefined, taskId: input.taskId ?? undefined, payload: { source: input.source, patternCount: input.count } });
}

export function sanitizeForPolicy(db: Database.Database | null, value: string, input: { projectId?: string | null; taskId?: string | null; source?: string; now?: string; audit?: PolicyAuditWriter } = {}) {
  const result = redactSecrets(value);
  if (db && result.redacted) recordSecretRedaction(db, { projectId: input.projectId, taskId: input.taskId, source: input.source ?? "unknown", count: result.count, now: input.now ?? new Date().toISOString(), audit: input.audit });
  return result.value;
}

export function containsLiteralSecret(value: string | null | undefined) {
  if (!value) return false;
  return secretPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function getProjectSecurityPolicy(db: Database.Database, projectId: string) {
  const project = projectRow(db, projectId);
  if (!project) throw new PermissionDeniedError("Project not found");
  const policy = hasTable(db, "project_security_policies")
    ? db.prepare(`SELECT p.id,p.project_id AS projectId,p.permission_profile_id AS permissionProfileId,p.sandbox_enabled AS sandboxEnabled,p.network_enabled AS networkEnabled,p.provider_calls_enabled AS providerCallsEnabled,p.secrets_blocked AS secretsBlocked,p.command_policy_json AS commandPolicyJson,p.file_policy_json AS filePolicyJson,p.provider_policy_json AS providerPolicyJson,p.cost_policy_json AS costPolicyJson,profiles.name AS profileName,profiles.defaults_json AS profileDefaultsJson,profiles.requires_approval AS profileRequiresApproval
      FROM project_security_policies p LEFT JOIN permission_profiles profiles ON profiles.id=p.permission_profile_id WHERE p.project_id=?`).get(projectId) as any
    : null;
  return {
    project,
    id: policy?.id ?? null,
    permissionProfileId: policy?.permissionProfileId ?? project.permissionProfileId ?? "standard-governed",
    profileName: policy?.profileName ?? "Standard governed",
    sandboxEnabled: policy ? Boolean(policy.sandboxEnabled) : true,
    networkEnabled: policy ? Boolean(policy.networkEnabled) : false,
    providerCallsEnabled: policy ? Boolean(policy.providerCallsEnabled) : true,
    secretsBlocked: policy ? Boolean(policy.secretsBlocked) : true,
    commandPolicy: safeJson<Record<string, unknown>>(policy?.commandPolicyJson, {}),
    filePolicy: safeJson<Record<string, unknown>>(policy?.filePolicyJson, {}),
    providerPolicy: safeJson<Record<string, unknown>>(policy?.providerPolicyJson, { adapterOnly: true }),
    costPolicy: safeJson<Record<string, unknown>>(policy?.costPolicyJson, {}),
    profileDefaults: safeJson<Record<string, unknown>>(policy?.profileDefaultsJson, {})
  };
}

function recordDecision(db: Database.Database, input: { projectId?: string | null; taskId?: string | null; agentId?: string | null; action: PermissionAction; resource?: string | null; decision: PermissionDecision; riskClass?: string; reason: string; metadata?: unknown; now: string; audit?: PolicyAuditWriter }) {
  if (hasTable(db, "permission_decisions")) {
    db.prepare("INSERT INTO permission_decisions (id,project_id,task_id,agent_id,action,resource,decision,risk_class,reason,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(nanoid(), input.projectId ?? null, input.taskId ?? null, input.agentId ?? null, input.action, input.resource ?? null, input.decision, input.riskClass ?? "safe-read-only", input.reason, JSON.stringify(input.metadata ?? {}), input.now);
  }
  if (hasTable(db, "sandbox_events")) {
    db.prepare("INSERT INTO sandbox_events (id,project_id,task_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(nanoid(), input.projectId ?? null, input.taskId ?? null, input.decision === "ALLOW" ? "PERMISSION_ALLOWED" : input.decision === "APPROVAL_REQUIRED" ? "HIGH_RISK_APPROVAL_REQUIRED" : "PERMISSION_DENIED", input.reason, JSON.stringify({ action: input.action, resource: input.resource, riskClass: input.riskClass, metadata: input.metadata ?? {} }), input.now);
  }
  input.audit?.(input.decision === "ALLOW" ? "PERMISSION_ALLOWED" : input.decision === "APPROVAL_REQUIRED" ? "HIGH_RISK_APPROVAL_REQUIRED" : "PERMISSION_DENIED", input.reason, { projectId: input.projectId ?? undefined, taskId: input.taskId ?? undefined, agentId: input.agentId ?? undefined, payload: { action: input.action, resource: input.resource, riskClass: input.riskClass } });
}

function deny(db: Database.Database, input: Parameters<typeof recordDecision>[1]): never {
  recordDecision(db, { ...input, decision: input.decision ?? "DENY" });
  throw new PermissionDeniedError(input.reason, input.decision ?? "DENY");
}

export function assertProjectActiveForPolicy(db: Database.Database, projectId: string, input: { action: PermissionAction; taskId?: string | null; agentId?: string | null; now: string; audit?: PolicyAuditWriter }) {
  const project = projectRow(db, projectId);
  const reservedScaffold = project?.status === "PAUSED" && input.taskId && hasTable(db, "scaffold_jobs")
    ? db.prepare("SELECT id FROM scaffold_jobs WHERE task_id=? AND target_project_id=? AND mode='CREATE_PROJECT' AND status IN ('PLANNED','AWAITING_APPROVAL','PROPOSALS_GENERATED')").get(input.taskId, projectId)
    : null;
  if (!project || (project.status !== "ACTIVE" && !reservedScaffold)) {
    deny(db, { projectId, taskId: input.taskId, agentId: input.agentId, action: input.action, decision: "DENY", reason: "Paused, archived, de-registered, or missing projects are blocked", now: input.now, audit: input.audit });
  }
  return project;
}

export function assertFilePermission(db: Database.Database, input: { projectId: string; rootPath: string; filePath: string; action: "FILE_READ" | "FILE_PROPOSAL"; operation?: string; proposedContent?: string | null; taskId?: string | null; agentId?: string | null; now: string; audit?: PolicyAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: input.action, taskId: input.taskId, agentId: input.agentId, now: input.now, audit: input.audit });
  const target = validateProposalPath(input.rootPath, input.filePath);
  if (isSecretPath(target.relativePath)) {
    deny(db, { projectId: input.projectId, taskId: input.taskId, agentId: input.agentId, action: "SECRET_ACCESS", resource: target.relativePath, decision: "DENY", reason: "Secret access blocked by project policy", riskClass: "destructive", now: input.now, audit: input.audit });
  }
  if (input.action === "FILE_PROPOSAL" && input.proposedContent && containsLiteralSecret(input.proposedContent)) {
    deny(db, { projectId: input.projectId, taskId: input.taskId, agentId: input.agentId, action: input.action, resource: target.relativePath, decision: "DENY", reason: "Proposal contains a literal secret-like value", riskClass: "destructive", now: input.now, audit: input.audit });
  }
  if (input.operation === "DELETE") {
    deny(db, { projectId: input.projectId, taskId: input.taskId, agentId: input.agentId, action: input.action, resource: target.relativePath, decision: "DENY", reason: "Destructive deletes are blocked by default", riskClass: "destructive", now: input.now, audit: input.audit });
  }
  recordDecision(db, { projectId: input.projectId, taskId: input.taskId, agentId: input.agentId, action: input.action, resource: target.relativePath, decision: "ALLOW", reason: `${input.action.replaceAll("_", " ").toLowerCase()} allowed by project policy`, now: input.now, audit: input.audit });
  return target;
}

export function classifyCommandRisk(command: string): CommandRiskClass {
  const normalized = command.toLowerCase();
  if (/\b(rm|del|erase|rmdir|format|shutdown|reboot|kill|taskkill|remove-item)\b/.test(normalized)) return "destructive";
  if (/\b(curl|wget|scp|ssh|ftp|invoke-webrequest|fetch)\b/.test(normalized)) return "network";
  if (/\b(npm|pnpm|yarn|bun)\s+(install|add|update|upgrade)\b/.test(normalized)) return "package-install";
  if (/\b(migrate|migration|prisma migrate|drizzle-kit|sequelize db:migrate)\b/.test(normalized)) return "migration-database";
  if (/[;&|<>]/.test(command) || /\b(cp|copy|mv|move|mkdir|touch)\b/.test(normalized)) return "filesystem-mutation";
  if (/\b(test|vitest|jest|mocha|playwright|cypress)\b/.test(normalized)) return "test-check";
  if (/\b(build|typecheck|tsc|lint)\b/.test(normalized)) return "build-typecheck";
  return "safe-read-only";
}

export function assertCommandAllowed(db: Database.Database, input: { projectId: string; taskId?: string | null; action: string; script: string; command: string; now: string; audit?: PolicyAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: "COMMAND", taskId: input.taskId, now: input.now, audit: input.audit });
  const risk = classifyCommandRisk(input.command);
  if (!["typecheck", "lint", "test", "build"].includes(input.script)) {
    recordCommandDecision(db, input, risk, "DENY", "Arbitrary shell commands are blocked; only approved package.json check scripts may run");
    deny(db, { projectId: input.projectId, taskId: input.taskId, action: "COMMAND", resource: input.script, decision: "DENY", riskClass: risk, reason: "Arbitrary shell commands are blocked; only approved package.json check scripts may run", now: input.now, audit: input.audit });
  }
  if (risk === "destructive" || risk === "network" || risk === "filesystem-mutation") {
    recordCommandDecision(db, input, risk, "DENY", `${risk} commands are blocked by sandbox policy`);
    deny(db, { projectId: input.projectId, taskId: input.taskId, action: "COMMAND", resource: input.script, decision: "DENY", riskClass: risk, reason: `${risk} commands are blocked by sandbox policy`, now: input.now, audit: input.audit });
  }
  if (risk === "package-install" || risk === "migration-database") {
    recordCommandDecision(db, input, risk, "APPROVAL_REQUIRED", `${risk} commands require fresh human approval`);
    deny(db, { projectId: input.projectId, taskId: input.taskId, action: "COMMAND", resource: input.script, decision: "APPROVAL_REQUIRED", riskClass: risk, reason: `${risk} commands require fresh human approval`, now: input.now, audit: input.audit });
  }
  recordCommandDecision(db, input, risk, "ALLOW", "Approved package.json script allowed by sandbox policy");
  recordDecision(db, { projectId: input.projectId, taskId: input.taskId, action: "COMMAND", resource: input.script, decision: "ALLOW", riskClass: risk, reason: "Approved package.json script allowed by sandbox policy", now: input.now, audit: input.audit });
  return { riskClass: risk };
}

function recordCommandDecision(db: Database.Database, input: { projectId: string; taskId?: string | null; command: string; now: string }, riskClass: CommandRiskClass, decision: PermissionDecision, reason: string) {
  if (!hasTable(db, "command_policy_decisions")) return;
  db.prepare("INSERT INTO command_policy_decisions (id,project_id,task_id,command,risk_class,decision,reason,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(nanoid(), input.projectId, input.taskId ?? null, input.command, riskClass, decision, reason, input.now);
}

export function assertProviderAllowed(db: Database.Database, input: { projectId: string; taskId?: string | null; provider: string; configured: boolean; now: string; audit?: PolicyAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: "PROVIDER_CALL", taskId: input.taskId, now: input.now, audit: input.audit });
  const policy = getProjectSecurityPolicy(db, input.projectId);
  if (!input.configured || !policy.providerCallsEnabled || policy.providerPolicy.adapterOnly !== true) {
    deny(db, { projectId: input.projectId, taskId: input.taskId, action: "PROVIDER_CALL", resource: input.provider, decision: "DENY", riskClass: "network", reason: "Provider calls require enabled provider config and adapter policy", now: input.now, audit: input.audit });
  }
  recordDecision(db, { projectId: input.projectId, taskId: input.taskId, action: "PROVIDER_CALL", resource: input.provider, decision: "ALLOW", riskClass: "network", reason: "Provider adapter call allowed by project policy", now: input.now, audit: input.audit });
}

export function assertNetworkAllowed(db: Database.Database, input: { projectId: string; taskId?: string | null; host: string; now: string; audit?: PolicyAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: "NETWORK_ACCESS", taskId: input.taskId, now: input.now, audit: input.audit });
  const host = input.host.toLowerCase();
  const allowed = hasTable(db, "network_allowlist") && Boolean(db.prepare("SELECT id FROM network_allowlist WHERE project_id=? AND lower(host)=? AND status='ACTIVE'").get(input.projectId, host));
  if (!allowed) {
    recordDecision(db, { projectId: input.projectId, taskId: input.taskId, action: "NETWORK_ACCESS", resource: host, decision: "DENY", riskClass: "network", reason: "Network request blocked by default-deny project policy", now: input.now, audit: input.audit });
    input.audit?.("NETWORK_BLOCKED", `Network blocked for ${host}`, { projectId: input.projectId, taskId: input.taskId ?? undefined });
    throw new PermissionDeniedError("Network request blocked by default-deny project policy");
  }
  recordDecision(db, { projectId: input.projectId, taskId: input.taskId, action: "NETWORK_ACCESS", resource: host, decision: "ALLOW", riskClass: "network", reason: "Network host allowed by project allowlist", now: input.now, audit: input.audit });
  input.audit?.("NETWORK_ALLOWED", `Network allowed for ${host}`, { projectId: input.projectId, taskId: input.taskId ?? undefined });
}

export function assertTaskOwnedRollbackFiles(db: Database.Database, input: { taskId: string; projectId: string; filePaths: string[]; now: string; audit?: PolicyAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: "ROLLBACK", taskId: input.taskId, now: input.now, audit: input.audit });
  const rows = db.prepare("SELECT file_path AS filePath FROM applied_file_changes WHERE task_id=?").all(input.taskId) as Array<{ filePath: string }>;
  const owned = new Set(rows.map((row) => row.filePath));
  if (input.filePaths.some((filePath) => !owned.has(filePath))) {
    deny(db, { projectId: input.projectId, taskId: input.taskId, action: "ROLLBACK", decision: "DENY", reason: "Rollback and recovery can only touch task-owned files", now: input.now, audit: input.audit });
  }
  recordDecision(db, { projectId: input.projectId, taskId: input.taskId, action: "ROLLBACK", decision: "ALLOW", reason: "Rollback limited to task-owned files", now: input.now, audit: input.audit });
}

export function listPermissionProfiles(db: Database.Database) {
  return db.prepare("SELECT id,name,description,defaults_json AS defaultsJson,risk_level AS riskLevel,requires_approval AS requiresApproval,is_builtin AS isBuiltin FROM permission_profiles ORDER BY CASE id WHEN 'locked-down' THEN 0 WHEN 'standard-governed' THEN 1 WHEN 'advanced-development' THEN 2 ELSE 3 END").all();
}

export function listPermissionEvents(db: Database.Database, projectId: string) {
  return db.prepare("SELECT id,action,resource,decision,risk_class AS riskClass,reason,metadata_json AS metadataJson,created_at AS createdAt FROM permission_decisions WHERE project_id=? ORDER BY created_at DESC LIMIT 100").all(projectId);
}

export function requestProjectPolicyChange(db: Database.Database, input: { id: string; approvalId: string; projectId: string; profileId: string; reason: string; now: string; audit: PolicyAuditWriter }) {
  const current = getProjectSecurityPolicy(db, input.projectId);
  const profile = db.prepare("SELECT id,name,risk_level AS riskLevel,requires_approval AS requiresApproval FROM permission_profiles WHERE id=?").get(input.profileId) as { id: string; name: string; riskLevel: string; requiresApproval: number } | undefined;
  if (!profile) throw new PermissionDeniedError("Permission profile not found");
  const requiresApproval = Boolean(profile.requiresApproval);
  if (requiresApproval) {
    const taskId = `policy-task-${input.id}`;
    db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(taskId, input.projectId, null, "developer", `Security policy change to ${profile.name}`, input.reason, "AWAITING_APPROVAL", profile.riskLevel, JSON.stringify({ policyChange: { profileId: input.profileId, reason: input.reason } }), "Human approval required for policy elevation", "Revert to the previous permission profile.", input.now, input.now);
    db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(input.approvalId, taskId, "SANDBOX_POLICY_CHANGE", `Approve security policy change to ${profile.name}`, JSON.stringify({ policyChange: { requestId: input.id, projectId: input.projectId, profileId: input.profileId } }), profile.riskLevel, "PENDING", input.now);
    db.prepare("INSERT INTO security_policy_change_requests (id,project_id,requested_profile_id,previous_profile_id,approval_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(input.id, input.projectId, input.profileId, current.permissionProfileId, input.approvalId, input.reason, "PENDING", input.now);
    recordDecision(db, { projectId: input.projectId, action: "SPECIALIST_ACTION", decision: "APPROVAL_REQUIRED", riskClass: profile.riskLevel, reason: "Advanced or emergency policy changes require human approval", now: input.now, audit: input.audit });
    return { approvalRequired: true, approvalId: input.approvalId, status: "PENDING" };
  }
  applyProjectPolicyProfile(db, input.projectId, input.profileId, input.now, input.audit);
  db.prepare("INSERT INTO security_policy_change_requests (id,project_id,requested_profile_id,previous_profile_id,approval_id,reason,status,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(input.id, input.projectId, input.profileId, current.permissionProfileId, null, input.reason, "APPROVED", input.now, input.now);
  return { approvalRequired: false, status: "APPROVED" };
}

export function applyProjectPolicyProfile(db: Database.Database, projectId: string, profileId: string, now: string, audit?: PolicyAuditWriter) {
  const profile = db.prepare("SELECT defaults_json AS defaultsJson FROM permission_profiles WHERE id=?").get(profileId) as { defaultsJson: string } | undefined;
  if (!profile) throw new PermissionDeniedError("Permission profile not found");
  const defaults = safeJson<Record<string, unknown>>(profile.defaultsJson, {});
  db.prepare(`UPDATE project_security_policies SET permission_profile_id=?,sandbox_enabled=?,network_enabled=?,provider_calls_enabled=?,secrets_blocked=?,updated_at=? WHERE project_id=?`)
    .run(profileId, defaults.sandboxEnabled === false ? 0 : 1, defaults.networkEnabled === true ? 1 : 0, defaults.providerCallsEnabled === false ? 0 : 1, defaults.secretsBlocked === false ? 0 : 1, now, projectId);
  db.prepare("UPDATE projects SET permission_profile_id=?,updated_at=? WHERE id=?").run(profileId, now, projectId);
  audit?.("SANDBOX_POLICY_CHANGED", `Project permission profile changed to ${profileId}`, { projectId, payload: { profileId } });
}

export function resolveProjectPolicyApproval(db: Database.Database, approvalId: string, decision: "APPROVED" | "REJECTED", now: string, audit?: PolicyAuditWriter) {
  const request = db.prepare("SELECT id,project_id AS projectId,requested_profile_id AS requestedProfileId FROM security_policy_change_requests WHERE approval_id=? AND status='PENDING'").get(approvalId) as { id: string; projectId: string; requestedProfileId: string } | undefined;
  if (!request) return false;
  db.prepare("UPDATE security_policy_change_requests SET status=?,decided_at=? WHERE id=?").run(decision, now, request.id);
  if (decision === "APPROVED") applyProjectPolicyProfile(db, request.projectId, request.requestedProfileId, now, audit);
  return true;
}

export function assertWorkspaceTargetAllowed(db: Database.Database, input: { workspaceRootPath: string; targetRootPath: string; now: string; audit?: PolicyAuditWriter }) {
  const root = path.resolve(input.workspaceRootPath);
  const target = path.resolve(input.targetRootPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new PermissionDeniedError("Scaffold target path is outside the configured workspace root");
  }
}
