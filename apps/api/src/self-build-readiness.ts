import type Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { BuildMissionTarget } from "@s4/shared";
import { assertProjectActiveForPolicy, sanitizeForPolicy } from "./security-policy.js";
import { createTaskRound, updateTaskRound } from "./task-workflow.js";
import { decomposeSpecialistAssignments } from "./specialist-orchestration.js";

export type ReadinessDecision = "READY" | "READY_WITH_WARNINGS" | "NOT_READY";
export type ReadinessGateStatus = "PASS" | "FAIL" | "WARNING" | "NOT_CHECKED";
export type MissionGitMode = "BRANCH" | "WORKTREE";

export type SelfBuildAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown }) => void;

export class SelfBuildReadinessError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

type GateResult = {
  gateId: string;
  name: string;
  status: ReadinessGateStatus;
  explanation: string;
  evidence: Record<string, unknown>;
  blocking: boolean;
  recommendedFix: string;
  lastCheckedAt: string;
};

type MissionRow = {
  id: string;
  projectId: string;
  taskId: string | null;
  readinessRunId: string | null;
  targetModule: BuildMissionTarget;
  scope: string;
  dependenciesJson: string;
  riskLevel: string;
  requiredSpecialistsJson: string;
  scaffoldNeedsJson: string;
  gitMode: MissionGitMode;
  acceptanceCriteriaJson: string;
  rollbackPlan: string;
  status: string;
  approvalId: string | null;
  planJson: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  convertedAt: string | null;
};

const requiredGates = [
  ["governance", "Governance readiness"],
  ["security-policy", "Security policy readiness"],
  ["git-workflow", "Git workflow readiness"],
  ["scaffold-project-creation", "Scaffold/project creation readiness"],
  ["specialist-orchestration", "Specialist orchestration readiness"],
  ["approval-workflow", "Approval workflow readiness"],
  ["test-typecheck", "Test/typecheck readiness"],
  ["rollback-recovery", "Rollback/recovery readiness"],
  ["audit-history", "Audit/history readiness"],
  ["ui-controls", "UI control readiness"],
  ["secrets-network", "Secrets/network safety readiness"],
  ["human-final-authority", "Human final-authority readiness"]
] as const;

const targetDefaults: Record<BuildMissionTarget, { specialists: string[]; scaffold: Record<string, unknown>; acceptance: string[] }> = {
  "Agent Core extension": {
    specialists: ["PRODUCT_PLANNER", "BACKEND", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "empty-governed-project", mode: "ADD_MODULE", moduleName: "agent-core" },
    acceptance: ["Agent extension is governed by proposals and approvals.", "Provider and permission policy checks remain enforced."]
  },
  "Social Studio": {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "internal-tool-admin", mode: "ADD_MODULE", moduleName: "social-studio" },
    acceptance: ["Social Studio routes and UI are behind App Studio governance.", "No publishing or network automation runs without approval."]
  },
  "Growth Studio": {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "internal-tool-admin", mode: "ADD_MODULE", moduleName: "growth-studio" },
    acceptance: ["Growth workflows remain planning/proposal-first.", "Metrics and experiments do not expose secrets."]
  },
  CRM: {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "DATABASE", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "internal-tool-admin", mode: "ADD_MODULE", moduleName: "crm" },
    acceptance: ["CRM data model changes are high risk and reversible.", "Client records are protected by sandbox and audit controls."]
  },
  "Cloud Studio": {
    specialists: ["PRODUCT_PLANNER", "BACKEND", "DEVOPS", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "node-fastify-api", mode: "ADD_MODULE", moduleName: "cloud-studio" },
    acceptance: ["Cloud operations are represented as plans only.", "No deployment automation or remote push is introduced."]
  },
  "Finance & Billing Studio": {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "DATABASE", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "internal-tool-admin", mode: "ADD_MODULE", moduleName: "finance-billing" },
    acceptance: ["Billing changes require high-risk approval.", "Rollback guidance exists for any schema or ledger change."]
  },
  "Business Control Centre": {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "DATABASE", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "internal-tool-admin", mode: "ADD_MODULE", moduleName: "business-control-centre" },
    acceptance: ["Admin workflows include final human authority.", "Audit visibility covers critical decisions."]
  },
  "Client Portal": {
    specialists: ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "nextjs-web-app", mode: "ADD_MODULE", moduleName: "client-portal" },
    acceptance: ["Client portal access paths are governed and testable.", "No client secrets appear in UI or logs."]
  },
  "General Custom Module": {
    specialists: ["PRODUCT_PLANNER", "BACKEND", "TESTING_SPECIALIST", "SECURITY_REVIEW", "FINAL_REVIEW"],
    scaffold: { template: "empty-governed-project", mode: "ADD_MODULE", moduleName: "custom-module" },
    acceptance: ["Custom module scope is converted to governed task steps.", "No files are generated until proposal approval."]
  }
};

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function projectRow(db: Database.Database, projectId: string) {
  return db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as { id: string; name: string; rootPath: string; status: string } | undefined;
}

function countRows(db: Database.Database, table: string, where = "", params: unknown[] = []) {
  if (!hasTable(db, table)) return 0;
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as { count: number }).count;
}

function gate(input: Omit<GateResult, "lastCheckedAt">, now: string): GateResult {
  return { ...input, lastCheckedAt: now };
}

function sanitizeObject(db: Database.Database, value: Record<string, unknown>, input: { projectId: string; now: string; audit: SelfBuildAuditWriter }) {
  const clean = sanitizeForPolicy(db, JSON.stringify(value), { projectId: input.projectId, source: "self-build-readiness", now: input.now, audit: input.audit });
  return safeJson<Record<string, unknown>>(clean, {});
}

async function packageScripts(rootPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(rootPath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

async function evaluateGates(db: Database.Database, projectId: string, now: string, audit: SelfBuildAuditWriter): Promise<GateResult[]> {
  const project = projectRow(db, projectId);
  const results: GateResult[] = [];
  if (!project) throw new SelfBuildReadinessError("Project not found", 404);
  try {
    assertProjectActiveForPolicy(db, projectId, { action: "SPECIALIST_ACTION", now, audit });
  } catch {
    results.push(gate({ gateId: "governance", name: "Governance readiness", status: "FAIL", explanation: "Project is not active for governed work.", evidence: { projectStatus: project.status }, blocking: true, recommendedFix: "Resume or register an active App Studio project before self-building." }, now));
  }

  if (!results.some((result) => result.gateId === "governance")) {
    const tables = ["tasks", "task_rounds", "change_proposals", "approvals", "audit_events"];
    const missing = tables.filter((table) => !hasTable(db, table));
    const developer = hasTable(db, "agents") ? db.prepare("SELECT id FROM agents WHERE id='developer' OR role='DEVELOPER' LIMIT 1").get() : null;
    results.push(gate({ gateId: "governance", name: "Governance readiness", status: missing.length || !developer ? "FAIL" : "PASS", explanation: missing.length || !developer ? "Core governed workflow records are unavailable." : "Task, proposal, approval, and audit records are available.", evidence: { missingTables: missing, developerAgent: Boolean(developer) }, blocking: true, recommendedFix: "Run database migrations and seed the Developer Agent." }, now));
  }

  const policy = hasTable(db, "project_security_policies") ? db.prepare("SELECT sandbox_enabled AS sandboxEnabled,network_enabled AS networkEnabled,provider_calls_enabled AS providerCallsEnabled,secrets_blocked AS secretsBlocked FROM project_security_policies WHERE project_id=?").get(projectId) as { sandboxEnabled: number; networkEnabled: number; providerCallsEnabled: number; secretsBlocked: number } | undefined : undefined;
  results.push(gate({ gateId: "security-policy", name: "Security policy readiness", status: policy?.sandboxEnabled && policy.secretsBlocked ? "PASS" : "FAIL", explanation: policy ? "Project security policy is configured." : "Project security policy is missing.", evidence: { configured: Boolean(policy), sandboxEnabled: Boolean(policy?.sandboxEnabled), secretsBlocked: Boolean(policy?.secretsBlocked) }, blocking: true, recommendedFix: "Create the default standard governed project security policy." }, now));

  const gitSettings = hasTable(db, "project_git_settings") ? db.prepare("SELECT branch_mode_enabled AS branchModeEnabled,worktree_mode_enabled AS worktreeModeEnabled,merge_strategy AS mergeStrategy,worktree_root_path AS worktreeRootPath FROM project_git_settings WHERE project_id=?").get(projectId) as { branchModeEnabled: number; worktreeModeEnabled: number; mergeStrategy: string; worktreeRootPath: string } | undefined : undefined;
  const gitStatus: ReadinessGateStatus = !gitSettings || (!gitSettings.branchModeEnabled && !gitSettings.worktreeModeEnabled) ? "FAIL" : gitSettings.branchModeEnabled && gitSettings.worktreeModeEnabled ? "PASS" : "WARNING";
  results.push(gate({ gateId: "git-workflow", name: "Git workflow readiness", status: gitStatus, explanation: gitStatus === "PASS" ? "Governed branch and worktree settings are present." : gitStatus === "WARNING" ? "Only one governed Git mode is enabled." : "Project Git workflow settings are missing or disabled.", evidence: { configured: Boolean(gitSettings), branchMode: Boolean(gitSettings?.branchModeEnabled), worktreeMode: Boolean(gitSettings?.worktreeModeEnabled), mergeStrategy: gitSettings?.mergeStrategy }, blocking: gitStatus === "FAIL", recommendedFix: "Seed project Git settings and configure both branch and approved worktree support." }, now));

  const scaffoldTemplates = countRows(db, "scaffold_templates", "WHERE is_builtin=1");
  const workspaceRoots = countRows(db, "workspace_root_config", "WHERE status='ACTIVE'");
  results.push(gate({ gateId: "scaffold-project-creation", name: "Scaffold/project creation readiness", status: scaffoldTemplates > 0 && workspaceRoots > 0 ? "PASS" : "FAIL", explanation: "Scaffold templates and workspace roots are required before self-building modules.", evidence: { builtinTemplates: scaffoldTemplates, activeWorkspaceRoots: workspaceRoots }, blocking: true, recommendedFix: "Seed built-in scaffold templates and activate a workspace root." }, now));

  const requiredRoles = ["PRODUCT_PLANNER", "FRONTEND", "BACKEND", "DATABASE", "TESTING_SPECIALIST", "SECURITY_REVIEW", "DEVOPS", "FINAL_REVIEW"];
  const activeRoles = hasTable(db, "agents") ? (db.prepare("SELECT role FROM agents WHERE status='ACTIVE'").all() as Array<{ role: string }>).map((row) => row.role) : [];
  const missingRoles = requiredRoles.filter((role) => !activeRoles.includes(role));
  results.push(gate({ gateId: "specialist-orchestration", name: "Specialist orchestration readiness", status: missingRoles.length ? "FAIL" : "PASS", explanation: missingRoles.length ? "One or more specialist roles are unavailable." : "All required specialist roles are active.", evidence: { missingRoles }, blocking: true, recommendedFix: "Seed or activate the required specialist agent registry." }, now));

  const approvalReady = hasTable(db, "approvals") && hasTable(db, "tasks");
  results.push(gate({ gateId: "approval-workflow", name: "Approval workflow readiness", status: approvalReady ? "PASS" : "FAIL", explanation: approvalReady ? "Human approval workflow tables are available." : "Approval workflow records are unavailable.", evidence: { approvalsTable: hasTable(db, "approvals"), tasksTable: hasTable(db, "tasks") }, blocking: true, recommendedFix: "Run migrations for tasks and approvals." }, now));

  const scripts = await packageScripts(project.rootPath);
  const hasTypecheck = typeof scripts.typecheck === "string";
  const hasTest = typeof scripts.test === "string";
  results.push(gate({ gateId: "test-typecheck", name: "Test/typecheck readiness", status: hasTypecheck && hasTest ? "PASS" : "FAIL", explanation: hasTypecheck && hasTest ? "Project exposes approved typecheck and test scripts." : "Project must represent both typecheck and test scripts before self-building.", evidence: { scripts: Object.keys(scripts), hasTypecheck, hasTest }, blocking: true, recommendedFix: "Add approved package.json scripts for typecheck and test." }, now));

  const recoveryReady = hasTable(db, "task_executions") && hasTable(db, "applied_file_changes") && hasTable(db, "task_rounds");
  results.push(gate({ gateId: "rollback-recovery", name: "Rollback/recovery readiness", status: recoveryReady ? "PASS" : "FAIL", explanation: recoveryReady ? "Rollback, checkpoint, and recovery history tables are available." : "Rollback/recovery records are unavailable.", evidence: { taskExecutions: hasTable(db, "task_executions"), appliedFileChanges: hasTable(db, "applied_file_changes"), taskRounds: hasTable(db, "task_rounds") }, blocking: true, recommendedFix: "Run migrations for execution, rollback, and task round history." }, now));

  const auditReady = hasTable(db, "audit_events") && hasTable(db, "task_rounds") && hasTable(db, "self_build_readiness_runs");
  results.push(gate({ gateId: "audit-history", name: "Audit/history readiness", status: auditReady ? "PASS" : "FAIL", explanation: auditReady ? "Audit and task history records are available." : "Audit/history records are unavailable.", evidence: { auditEvents: hasTable(db, "audit_events"), taskRounds: hasTable(db, "task_rounds"), readinessRuns: hasTable(db, "self_build_readiness_runs") }, blocking: true, recommendedFix: "Run migrations for audit, task history, and readiness reports." }, now));

  const uiTables = hasTable(db, "build_missions") && hasTable(db, "self_build_readiness_gate_results");
  results.push(gate({ gateId: "ui-controls", name: "UI control readiness", status: uiTables ? "PASS" : "WARNING", explanation: uiTables ? "Readiness and mission state can be shown in App Studio." : "Readiness UI state tables are unavailable.", evidence: { buildMissions: hasTable(db, "build_missions"), gateResults: hasTable(db, "self_build_readiness_gate_results") }, blocking: false, recommendedFix: "Run the readiness DB migration and reload App Studio." }, now));

  results.push(gate({ gateId: "secrets-network", name: "Secrets/network safety readiness", status: policy?.secretsBlocked && !policy.networkEnabled ? "PASS" : "FAIL", explanation: policy?.secretsBlocked && !policy.networkEnabled ? "Secrets are blocked and network is default-deny." : "Secrets or network policy is unsafe for self-building.", evidence: { secretsBlocked: Boolean(policy?.secretsBlocked), networkEnabled: Boolean(policy?.networkEnabled) }, blocking: true, recommendedFix: "Use the standard governed profile with secrets blocked and network disabled by default." }, now));

  const finalAuthority = approvalReady && hasTable(db, "release_candidates") && hasTable(db, "security_policy_change_requests");
  results.push(gate({ gateId: "human-final-authority", name: "Human final-authority readiness", status: finalAuthority ? "PASS" : "FAIL", explanation: finalAuthority ? "Human approval gates exist for task, policy, and merge decisions." : "Final human authority cannot be proven.", evidence: { approvals: approvalReady, releaseCandidates: hasTable(db, "release_candidates"), policyChangeRequests: hasTable(db, "security_policy_change_requests") }, blocking: true, recommendedFix: "Run migrations for approval, merge, and policy-change gates." }, now));

  return requiredGates.map(([gateId]) => results.find((result) => result.gateId === gateId) ?? gate({ gateId, name: requiredGates.find((entry) => entry[0] === gateId)![1], status: "NOT_CHECKED", explanation: "Gate was not evaluated.", evidence: {}, blocking: true, recommendedFix: "Review readiness evaluator configuration." }, now));
}

function decisionFor(results: GateResult[]): ReadinessDecision {
  if (results.some((result) => result.blocking && result.status === "FAIL")) return "NOT_READY";
  if (results.some((result) => result.status === "WARNING")) return "READY_WITH_WARNINGS";
  return "READY";
}

export async function runSelfBuildReadiness(db: Database.Database, input: { id: string; projectId: string; now: string; audit: SelfBuildAuditWriter }) {
  const results = await evaluateGates(db, input.projectId, input.now, input.audit);
  const decision = decisionFor(results);
  const blockerCount = results.filter((result) => result.blocking && result.status === "FAIL").length;
  const warningCount = results.filter((result) => result.status === "WARNING").length;
  const summary = decision === "READY" ? "App Studio is ready for governed self-building." : decision === "READY_WITH_WARNINGS" ? "App Studio is ready with warnings that need review." : "App Studio is not ready for self-building.";
  db.prepare("INSERT INTO self_build_readiness_runs (id,project_id,decision,status,summary,blocker_count,warning_count,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(input.id, input.projectId, decision, "COMPLETED", sanitizeForPolicy(db, summary, { projectId: input.projectId, source: "readiness-summary", now: input.now, audit: input.audit }), blockerCount, warningCount, JSON.stringify({ requiredGateCount: requiredGates.length }), input.now);
  for (const result of results) {
    db.prepare(`INSERT INTO self_build_readiness_gate_results (id,run_id,project_id,gate_id,name,status,explanation,evidence_json,blocking,recommended_fix,last_checked_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(nanoid(), input.id, input.projectId, result.gateId, result.name, result.status, sanitizeForPolicy(db, result.explanation, { projectId: input.projectId, source: "readiness-explanation", now: input.now, audit: input.audit }), JSON.stringify(sanitizeObject(db, result.evidence, { projectId: input.projectId, now: input.now, audit: input.audit })), result.blocking ? 1 : 0, sanitizeForPolicy(db, result.recommendedFix, { projectId: input.projectId, source: "readiness-fix", now: input.now, audit: input.audit }), result.lastCheckedAt);
  }
  input.audit("SELF_BUILD_READINESS_RUN", summary, { projectId: input.projectId, payload: { runId: input.id, decision, blockerCount, warningCount } });
  return getReadinessReport(db, input.id);
}

export function getReadinessReport(db: Database.Database, runId: string) {
  const run = db.prepare("SELECT id,project_id AS projectId,decision,status,summary,blocker_count AS blockerCount,warning_count AS warningCount,metadata_json AS metadataJson,created_at AS createdAt FROM self_build_readiness_runs WHERE id=?").get(runId) as any;
  if (!run) throw new SelfBuildReadinessError("Readiness run not found", 404);
  const gates = db.prepare("SELECT id,gate_id AS gateId,name,status,explanation,evidence_json AS evidenceJson,blocking,recommended_fix AS recommendedFix,last_checked_at AS lastCheckedAt FROM self_build_readiness_gate_results WHERE run_id=? ORDER BY rowid").all(runId) as any[];
  return { ...run, metadata: safeJson(run.metadataJson, {}), gates: gates.map((gate) => ({ ...gate, blocking: Boolean(gate.blocking), evidence: safeJson(gate.evidenceJson, {}) })) };
}

export function getLatestReadinessReport(db: Database.Database, projectId: string) {
  const row = db.prepare("SELECT id FROM self_build_readiness_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 1").get(projectId) as { id: string } | undefined;
  return row ? getReadinessReport(db, row.id) : null;
}

export function listReadinessHistory(db: Database.Database, projectId: string) {
  return db.prepare("SELECT id,project_id AS projectId,decision,status,summary,blocker_count AS blockerCount,warning_count AS warningCount,created_at AS createdAt FROM self_build_readiness_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 20").all(projectId);
}

function recordMissionEvent(db: Database.Database, input: { missionId: string; projectId: string; eventType: string; summary: string; payload?: unknown; now: string; audit: SelfBuildAuditWriter; taskId?: string | null }) {
  const cleanSummary = sanitizeForPolicy(db, input.summary, { projectId: input.projectId, taskId: input.taskId, source: "build-mission-event", now: input.now, audit: input.audit });
  const cleanPayload = input.payload ? sanitizeObject(db, input.payload as Record<string, unknown>, { projectId: input.projectId, now: input.now, audit: input.audit }) : {};
  db.prepare("INSERT INTO build_mission_events (id,project_id,build_mission_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(nanoid(), input.projectId, input.missionId, input.eventType, cleanSummary, JSON.stringify(cleanPayload), input.now);
  input.audit(input.eventType, cleanSummary, { projectId: input.projectId, taskId: input.taskId ?? undefined, payload: cleanPayload });
}

function missionPlan(input: { targetModule: BuildMissionTarget; scope: string; dependencies: string[]; riskLevel: string; gitMode: MissionGitMode }) {
  const defaults = targetDefaults[input.targetModule];
  return {
    targetModule: input.targetModule,
    scope: input.scope,
    dependencies: input.dependencies,
    riskLevel: input.riskLevel,
    requiredSpecialists: defaults.specialists,
    scaffoldNeeds: defaults.scaffold,
    gitMode: input.gitMode,
    acceptanceCriteria: defaults.acceptance,
    rollbackPlan: `Use App Studio rollback/recovery for task-owned files and branch/worktree rollback for ${input.targetModule}.`,
    nextAction: "REQUEST_BUILD_MISSION_APPROVAL"
  };
}

export function createBuildMissionDraft(db: Database.Database, input: { id: string; projectId: string; targetModule: BuildMissionTarget; scope: string; dependencies?: string[]; riskLevel: string; gitMode: MissionGitMode; now: string; audit: SelfBuildAuditWriter }) {
  assertProjectActiveForPolicy(db, input.projectId, { action: "SPECIALIST_ACTION", now: input.now, audit: input.audit });
  const latest = getLatestReadinessReport(db, input.projectId);
  const plan = missionPlan({ targetModule: input.targetModule, scope: input.scope, dependencies: input.dependencies ?? [], riskLevel: input.riskLevel, gitMode: input.gitMode });
  const taskId = nanoid();
  db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, input.projectId, null, "developer", `Build Mission: ${input.targetModule}`, input.scope, "PLANNING", input.riskLevel, JSON.stringify({ buildMission: plan }), plan.acceptanceCriteria.join("\n"), plan.rollbackPlan, input.now, input.now);
  const round = createTaskRound(db, { taskId, userMessage: input.scope, summary: `Build Mission: ${input.targetModule}`, roundType: "INITIAL", status: "PLANNING", context: { buildMission: plan }, approvalRequired: true, nextRequiredAction: "REQUEST_BUILD_MISSION_APPROVAL", now: input.now });
  db.prepare(`INSERT INTO build_missions (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,plan_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, input.projectId, taskId, latest?.id ?? null, input.targetModule, sanitizeForPolicy(db, input.scope, { projectId: input.projectId, taskId, source: "build-mission-scope", now: input.now, audit: input.audit }), JSON.stringify(input.dependencies ?? []), input.riskLevel, JSON.stringify(plan.requiredSpecialists), JSON.stringify(plan.scaffoldNeeds), input.gitMode, JSON.stringify(plan.acceptanceCriteria), plan.rollbackPlan, "DRAFT", JSON.stringify(plan), input.now, input.now);
  plan.requiredSpecialists.forEach((role, priority) => {
    db.prepare("INSERT INTO build_mission_specialist_plan (id,build_mission_id,role,priority,rationale,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(nanoid(), input.id, role, priority, `${role} participates in ${input.targetModule} planning and review.`, "PLANNED", input.now, input.now);
  });
  recordMissionEvent(db, { missionId: input.id, projectId: input.projectId, taskId, eventType: "BUILD_MISSION_DRAFT_CREATED", summary: `Build mission draft created for ${input.targetModule}`, payload: { targetModule: input.targetModule, gitMode: input.gitMode, planningOnly: true }, now: input.now, audit: input.audit });
  return getBuildMission(db, input.id);
}

export function getBuildMission(db: Database.Database, missionId: string) {
  const row = db.prepare("SELECT id,project_id AS projectId,task_id AS taskId,readiness_run_id AS readinessRunId,target_module AS targetModule,scope,dependencies_json AS dependenciesJson,risk_level AS riskLevel,required_specialists_json AS requiredSpecialistsJson,scaffold_needs_json AS scaffoldNeedsJson,git_mode AS gitMode,acceptance_criteria_json AS acceptanceCriteriaJson,rollback_plan AS rollbackPlan,status,approval_id AS approvalId,plan_json AS planJson,created_at AS createdAt,updated_at AS updatedAt,approved_at AS approvedAt,converted_at AS convertedAt FROM build_missions WHERE id=?").get(missionId) as MissionRow | undefined;
  if (!row) throw new SelfBuildReadinessError("Build mission not found", 404);
  const specialists = db.prepare("SELECT id,role,priority,rationale,status,created_at AS createdAt,updated_at AS updatedAt FROM build_mission_specialist_plan WHERE build_mission_id=? ORDER BY priority").all(missionId);
  return { ...row, dependencies: safeJson(row.dependenciesJson, []), requiredSpecialists: safeJson(row.requiredSpecialistsJson, []), scaffoldNeeds: safeJson(row.scaffoldNeedsJson, {}), acceptanceCriteria: safeJson(row.acceptanceCriteriaJson, []), plan: safeJson(row.planJson, {}), specialists };
}

export function listBuildMissions(db: Database.Database, projectId: string) {
  return (db.prepare("SELECT id FROM build_missions WHERE project_id=? ORDER BY created_at DESC LIMIT 50").all(projectId) as Array<{ id: string }>).map((row) => getBuildMission(db, row.id));
}

export function requestBuildMissionApproval(db: Database.Database, missionId: string, input: { approvalId: string; now: string; audit: SelfBuildAuditWriter }) {
  const mission = getBuildMission(db, missionId);
  if (!mission.taskId) throw new SelfBuildReadinessError("Build mission task is missing", 409);
  if (mission.approvalId) return { approvalId: mission.approvalId, status: mission.status };
  db.prepare("INSERT INTO approvals (id,task_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(input.approvalId, mission.taskId, "BUILD_MISSION", `Approve build mission for ${mission.targetModule}`, JSON.stringify({ buildMissionId: mission.id, targetModule: mission.targetModule }), mission.riskLevel, "PENDING", input.now);
  db.prepare("UPDATE build_missions SET status='AWAITING_APPROVAL',approval_id=?,updated_at=? WHERE id=?").run(input.approvalId, input.now, mission.id);
  db.prepare("UPDATE tasks SET status='AWAITING_APPROVAL',updated_at=? WHERE id=?").run(input.now, mission.taskId);
  recordMissionEvent(db, { missionId: mission.id, projectId: mission.projectId, taskId: mission.taskId, eventType: "BUILD_MISSION_APPROVAL_REQUESTED", summary: `Build mission approval requested for ${mission.targetModule}`, payload: { approvalId: input.approvalId }, now: input.now, audit: input.audit });
  return { approvalId: input.approvalId, status: "AWAITING_APPROVAL" };
}

export function resolveBuildMissionApproval(db: Database.Database, approvalId: string, decision: "APPROVED" | "REJECTED", now: string, audit: SelfBuildAuditWriter, actor: "human" | "agent" = "human") {
  if (actor === "agent") throw new SelfBuildReadinessError("Agents cannot approve build missions", 403);
  const mission = db.prepare("SELECT id,project_id AS projectId,task_id AS taskId,target_module AS targetModule FROM build_missions WHERE approval_id=? AND status='AWAITING_APPROVAL'").get(approvalId) as { id: string; projectId: string; taskId: string | null; targetModule: string } | undefined;
  if (!mission) return false;
  db.prepare("UPDATE build_missions SET status=?,approved_at=?,updated_at=? WHERE id=?").run(decision === "APPROVED" ? "APPROVED" : "REJECTED", decision === "APPROVED" ? now : null, now, mission.id);
  if (mission.taskId) db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(decision === "APPROVED" ? "APPROVED" : "CANCELLED", now, mission.taskId);
  recordMissionEvent(db, { missionId: mission.id, projectId: mission.projectId, taskId: mission.taskId, eventType: decision === "APPROVED" ? "BUILD_MISSION_APPROVED" : "BUILD_MISSION_REJECTED", summary: `Build mission ${decision.toLowerCase()} for ${mission.targetModule}`, payload: { approvalId }, now, audit });
  return true;
}

export function convertApprovedBuildMission(db: Database.Database, missionId: string, input: { gitMode?: MissionGitMode; now: string; audit: SelfBuildAuditWriter }) {
  const mission = getBuildMission(db, missionId);
  if (mission.status !== "APPROVED" || !mission.taskId) throw new SelfBuildReadinessError("Build mission requires human approval before conversion", 409);
  const latest = getLatestReadinessReport(db, mission.projectId);
  if (!latest || latest.decision === "NOT_READY") throw new SelfBuildReadinessError("Build mission execution is blocked until readiness is READY or READY_WITH_WARNINGS", 409);
  assertProjectActiveForPolicy(db, mission.projectId, { action: "SPECIALIST_ACTION", taskId: mission.taskId, now: input.now, audit: input.audit });
  const gitMode = input.gitMode ?? mission.gitMode;
  const plan = { ...mission.plan, gitMode, nextAction: "CREATE_GIT_WORKFLOW", readinessDecision: latest.decision, approvalId: mission.approvalId };
  db.prepare("UPDATE tasks SET status='APPROVED',plan_json=?,updated_at=? WHERE id=?").run(JSON.stringify({ buildMission: plan }), input.now, mission.taskId);
  const round = createTaskRound(db, { taskId: mission.taskId, userMessage: mission.scope, summary: `Approved Build Mission: ${mission.targetModule}`, roundType: "CONTINUATION", status: "APPROVED", context: { buildMission: plan }, approvalRequired: false, nextRequiredAction: "CREATE_GIT_WORKFLOW", now: input.now });
  const assignments = decomposeSpecialistAssignments(db, {
    taskId: mission.taskId,
    taskRoundId: round.id,
    projectId: mission.projectId,
    planSummary: `Approved build mission for ${mission.targetModule}`,
    planSteps: ["Create governed Git workflow.", "Generate proposals through specialist assignments.", "Run checks and request merge approval."],
    proposals: [],
    riskLevel: mission.riskLevel,
    now: input.now,
    audit: input.audit
  });
  updateTaskRound(db, round.id, { status: "APPROVED", nextRequiredAction: "CREATE_GIT_WORKFLOW", recoveryAvailable: false, now: input.now });
  db.prepare("UPDATE build_missions SET status='CONVERTED',git_mode=?,plan_json=?,converted_at=?,updated_at=? WHERE id=?").run(gitMode, JSON.stringify(plan), input.now, input.now, mission.id);
  recordMissionEvent(db, { missionId: mission.id, projectId: mission.projectId, taskId: mission.taskId, eventType: "BUILD_MISSION_CONVERTED", summary: `Build mission converted to governed task plan for ${mission.targetModule}`, payload: { gitMode, assignmentCount: assignments.length, readinessDecision: latest.decision }, now: input.now, audit: input.audit });
  return getBuildMission(db, mission.id);
}

export function listBuildMissionEvents(db: Database.Database, missionId: string) {
  return db.prepare("SELECT id,event_type AS eventType,summary,payload_json AS payloadJson,created_at AS createdAt FROM build_mission_events WHERE build_mission_id=? ORDER BY created_at DESC").all(missionId);
}
