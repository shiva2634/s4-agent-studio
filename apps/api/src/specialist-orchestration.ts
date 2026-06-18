import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { MediaStudioError } from "./media-studio.js";

export type SpecialistRole =
  | "PRODUCT_PLANNER"
  | "FRONTEND"
  | "BACKEND"
  | "DATABASE"
  | "TESTING_SPECIALIST"
  | "SECURITY_REVIEW"
  | "DEVOPS"
  | "FINAL_REVIEW";

export type SpecialistAssignmentStatus = "PENDING" | "READY" | "IN_PROGRESS" | "PAUSED" | "BLOCKED" | "RETRY_REQUIRED" | "COMPLETED" | "CANCELLED";
export type SpecialistAssignmentAction = "pause" | "resume" | "retry" | "cancel";

export type SpecialistAgentRow = {
  id: string;
  name: string;
  role: SpecialistRole | string;
  purpose: string;
  instructions: string;
  status: string;
  projectId: string | null;
  capabilitiesJson: string;
  allowedToolsJson: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecialistAssignmentRow = {
  id: string;
  taskId: string;
  taskRoundId: string | null;
  specialistAgentId: string;
  role: string;
  priority: number;
  status: SpecialistAssignmentStatus;
  attempts: number;
  dependencyAssignmentIdsJson: string;
  outputJson: string;
  findingsJson: string;
  reviewDecisionsJson: string;
  completionOrder: number | null;
  conflictState: string;
  riskLevel: string;
  canMutate: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type SpecialistAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown }) => void;

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

export function listSpecialistAgents(db: Database.Database, projectId?: string | null) {
  const rows = db.prepare(`SELECT id,name,role,purpose,instructions,status,project_id AS projectId,capabilities_json AS capabilitiesJson,allowed_tools_json AS allowedToolsJson,created_at AS createdAt,updated_at AS updatedAt
    FROM agents WHERE role != 'DEVELOPER' AND (? IS NULL OR project_id IS NULL OR project_id=?)
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at`).all(projectId ?? null, projectId ?? null) as SpecialistAgentRow[];
  return rows.map((agent) => ({
    ...agent,
    capabilities: safeJsonArray(agent.capabilitiesJson),
    allowedTools: safeJsonArray(agent.allowedToolsJson)
  }));
}

function safeJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function classifyProposalRole(filePath: string, operation: string): SpecialistRole {
  const normalized = filePath.toLowerCase();
  if (normalized.includes(".env") || normalized.includes("secrets") || normalized.includes("secret") || normalized.includes("credential")) return "SECURITY_REVIEW";
  if (normalized.includes("test") || normalized.includes("__tests__") || normalized.includes(".spec.") || normalized.includes(".test.") || normalized.includes("vitest") || normalized.includes("jest")) return "TESTING_SPECIALIST";
  if (normalized.includes("migration") || normalized.includes("schema") || normalized.endsWith(".sql") || normalized.includes("database")) return "DATABASE";
  if (normalized.includes("docker") || normalized.includes("deploy") || normalized.includes("ci") || normalized.includes("github/workflows") || normalized.includes("vercel") || normalized.includes("netlify") || normalized.includes("infra")) return "DEVOPS";
  if (normalized.includes("server") || normalized.includes("api") || normalized.includes("backend") || normalized.endsWith(".ts") || normalized.endsWith(".js") || normalized.endsWith(".go") || normalized.endsWith(".rb")) return "BACKEND";
  if (normalized.includes("ui") || normalized.includes("web") || normalized.includes("frontend") || normalized.endsWith(".tsx") || normalized.endsWith(".jsx") || normalized.endsWith(".css") || normalized.endsWith(".scss") || normalized.endsWith(".html")) return "FRONTEND";
  return operation === "CREATE" ? "BACKEND" : "PRODUCT_PLANNER";
}

function specialistAgentRoleKey(role: SpecialistRole) {
  const map: Record<SpecialistRole, string> = {
    PRODUCT_PLANNER: "PRODUCT_PLANNER",
    FRONTEND: "FRONTEND",
    BACKEND: "BACKEND",
    DATABASE: "DATABASE",
    TESTING_SPECIALIST: "TESTING_SPECIALIST",
    SECURITY_REVIEW: "SECURITY_REVIEW",
    DEVOPS: "DEVOPS",
    FINAL_REVIEW: "FINAL_REVIEW"
  };
  return map[role];
}

function agentForRole(db: Database.Database, role: SpecialistRole) {
  const row = db.prepare("SELECT id,name,role,purpose,instructions,status,project_id AS projectId,capabilities_json AS capabilitiesJson,allowed_tools_json AS allowedToolsJson,created_at AS createdAt,updated_at AS updatedAt FROM agents WHERE role=? ORDER BY created_at LIMIT 1").get(specialistAgentRoleKey(role)) as SpecialistAgentRow | undefined;
  if (!row) throw new MediaStudioError(`Specialist agent not registered: ${role}`, 500);
  return row;
}

function hasColumn(db: Database.Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function sortAssignments(assignments: Array<{ role: SpecialistRole; priority: number; proposalIds: string[]; findings: string[]; canMutate: boolean; riskLevel: string }>) {
  return assignments.sort((a, b) => a.priority - b.priority);
}

export function decomposeSpecialistAssignments(db: Database.Database, input: {
  taskId: string;
  taskRoundId: string | null;
  projectId: string;
  planSummary: string;
  planSteps: string[];
  proposals: Array<{ id: string; filePath: string; operation: string; reason: string; taskRoundId: string | null; agentId: string | null }>;
  riskLevel: string;
  now: string;
  audit: SpecialistAuditWriter;
}) {
  if (!hasTable(db, "task_assignments")) return [];
  const existing = db.prepare("SELECT COUNT(*) AS count FROM task_assignments WHERE task_id=? AND COALESCE(task_round_id,'')=COALESCE(?, '')").get(input.taskId, input.taskRoundId ?? null) as { count: number };
  if (existing.count > 0) {
    return listTaskAssignments(db, input.taskId);
  }
  const proposalRoles = new Map<SpecialistRole, Array<{ id: string; filePath: string; operation: string; reason: string }>>();
  for (const proposal of input.proposals) {
    const role = classifyProposalRole(proposal.filePath, proposal.operation);
    if (!proposalRoles.has(role)) proposalRoles.set(role, []);
    proposalRoles.get(role)!.push({ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, reason: proposal.reason });
  }
  const roles: SpecialistRole[] = ["PRODUCT_PLANNER", ...Array.from(proposalRoles.keys()).filter((role) => role !== "SECURITY_REVIEW" && role !== "FINAL_REVIEW"), "SECURITY_REVIEW", "FINAL_REVIEW"];
  const uniqueRoles = Array.from(new Set(roles));
  const completedOrder: string[] = [];
  const created: SpecialistAssignmentRow[] = [];
  for (let index = 0; index < uniqueRoles.length; index += 1) {
    const role = uniqueRoles[index];
    const agent = agentForRole(db, role);
    const relatedProposals = proposalRoles.get(role) ?? [];
    const canMutate = !["SECURITY_REVIEW", "FINAL_REVIEW"].includes(role);
    const status: SpecialistAssignmentStatus = !canMutate || role === "PRODUCT_PLANNER" ? "COMPLETED" : relatedProposals.length ? "COMPLETED" : "READY";
    const assignmentId = randomUUID();
    const dependencyIds = created.map((assignment) => assignment.id);
    const completionOrder = status === "COMPLETED" ? completedOrder.length + 1 : null;
    if (status === "COMPLETED") completedOrder.push(assignmentId);
    const output = {
      role,
      summary: role === "PRODUCT_PLANNER" ? input.planSummary : `${agent.name} completed ${relatedProposals.length || 0} proposal(s)`,
      proposals: relatedProposals,
      readOnly: !canMutate,
      riskLevel: role === "DATABASE" ? "high" : input.riskLevel,
      rollbackGuidance: role === "DATABASE" ? "Database proposals require high-risk approval and a reversible migration or documented manual rollback." : null,
      tests: role === "TESTING_SPECIALIST" ? ["Run existing checks before and after changes"] : [],
      reviewDecision: role === "SECURITY_REVIEW" || role === "FINAL_REVIEW" ? { verdict: "PASS", notes: "Read-only review completed." } : null
    };
    const findings = {
      role,
      notes: role === "SECURITY_REVIEW" ? ["No executable mutations produced by review-only agent."] : [],
      conflicts: []
    };
    db.prepare(`INSERT INTO task_assignments
      (id,task_id,task_round_id,specialist_agent_id,role,priority,status,attempts,dependency_assignment_ids_json,output_json,findings_json,review_decisions_json,completion_order,conflict_state,risk_level,can_mutate,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      assignmentId,
      input.taskId,
      input.taskRoundId,
      agent.id,
      role,
      index,
      status,
      1,
      JSON.stringify(dependencyIds),
      JSON.stringify(output),
      JSON.stringify(findings),
      JSON.stringify(output.reviewDecision ? [output.reviewDecision] : []),
      completionOrder,
      "NONE",
      role === "DATABASE" ? "high" : role === "TESTING_SPECIALIST" ? "medium" : input.riskLevel,
      canMutate ? 1 : 0,
      input.now,
      input.now,
      status === "COMPLETED" ? input.now : null
    );
    created.push({
      id: assignmentId,
      taskId: input.taskId,
      taskRoundId: input.taskRoundId,
      specialistAgentId: agent.id,
      role,
      priority: index,
      status,
      attempts: 1,
      dependencyAssignmentIdsJson: JSON.stringify(dependencyIds),
      outputJson: JSON.stringify(output),
      findingsJson: JSON.stringify(findings),
      reviewDecisionsJson: JSON.stringify(output.reviewDecision ? [output.reviewDecision] : []),
      completionOrder,
      conflictState: "NONE",
      riskLevel: role === "DATABASE" ? "high" : role === "TESTING_SPECIALIST" ? "medium" : input.riskLevel,
      canMutate: canMutate ? 1 : 0,
      createdAt: input.now,
      updatedAt: input.now,
      completedAt: status === "COMPLETED" ? input.now : null
    });
    input.audit("SPECIALIST_ASSIGNMENT_CREATED", `${agent.name} assigned to task`, { projectId: input.projectId, taskId: input.taskId, agentId: agent.id, payload: { assignmentId, role, proposalCount: relatedProposals.length } });
  }
  return created;
}

export function listTaskAssignments(db: Database.Database, taskId: string) {
  if (!hasTable(db, "task_assignments")) return [];
  return db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,specialist_agent_id AS specialistAgentId,role,priority,status,attempts,dependency_assignment_ids_json AS dependencyAssignmentIdsJson,output_json AS outputJson,findings_json AS findingsJson,review_decisions_json AS reviewDecisionsJson,completion_order AS completionOrder,conflict_state AS conflictState,risk_level AS riskLevel,can_mutate AS canMutate,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM task_assignments WHERE task_id=? ORDER BY created_at ASC`).all(taskId) as SpecialistAssignmentRow[];
}

export function attachSpecialistProposalOwnership(db: Database.Database, input: { taskId: string; taskRoundId: string | null; now: string }) {
  if (!hasTable(db, "task_assignments") || !hasTable(db, "change_proposals")) return [];
  if (!hasColumn(db, "change_proposals", "agent_id") || !hasColumn(db, "change_proposals", "task_assignment_id")) return [];
  const assignments = listTaskAssignments(db, input.taskId).filter((assignment) => (assignment.taskRoundId ?? null) === (input.taskRoundId ?? null));
  const byRole = new Map(assignments.map((assignment) => [assignment.role, assignment]));
  const proposals = db.prepare("SELECT id,file_path AS filePath,operation FROM change_proposals WHERE task_id=? AND COALESCE(task_round_id,'')=COALESCE(?, '') ORDER BY created_at")
    .all(input.taskId, input.taskRoundId ?? null) as Array<{ id: string; filePath: string; operation: string }>;
  const owned: Array<{ proposalId: string; assignmentId: string; agentId: string; role: string }> = [];
  for (const proposal of proposals) {
    const role = classifyProposalRole(proposal.filePath, proposal.operation);
    const assignment = byRole.get(role) ?? byRole.get("BACKEND") ?? null;
    if (!assignment) continue;
    db.prepare("UPDATE change_proposals SET agent_id=?,task_assignment_id=?,updated_at=? WHERE id=?")
      .run(assignment.specialistAgentId, assignment.id, input.now, proposal.id);
    owned.push({ proposalId: proposal.id, assignmentId: assignment.id, agentId: assignment.specialistAgentId, role: assignment.role });
  }
  return owned;
}

export function updateTaskAssignment(db: Database.Database, assignmentId: string, patch: Partial<{
  status: SpecialistAssignmentStatus;
  attempts: number;
  outputJson: string;
  findingsJson: string;
  reviewDecisionsJson: string;
  completionOrder: number | null;
  conflictState: string;
  riskLevel: string;
  completedAt: string | null;
}> & { now: string }) {
  if (!hasTable(db, "task_assignments")) return;
  const existing = db.prepare("SELECT id FROM task_assignments WHERE id=?").get(assignmentId);
  if (!existing) throw new MediaStudioError("Specialist assignment not found", 404);
  const columns: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.status) { columns.push("status=?"); values.push(patch.status); }
  if (patch.attempts !== undefined) { columns.push("attempts=?"); values.push(patch.attempts); }
  if (patch.outputJson !== undefined) { columns.push("output_json=?"); values.push(patch.outputJson); }
  if (patch.findingsJson !== undefined) { columns.push("findings_json=?"); values.push(patch.findingsJson); }
  if (patch.reviewDecisionsJson !== undefined) { columns.push("review_decisions_json=?"); values.push(patch.reviewDecisionsJson); }
  if (patch.completionOrder !== undefined) { columns.push("completion_order=?"); values.push(patch.completionOrder); }
  if (patch.conflictState !== undefined) { columns.push("conflict_state=?"); values.push(patch.conflictState); }
  if (patch.riskLevel !== undefined) { columns.push("risk_level=?"); values.push(patch.riskLevel); }
  if (patch.completedAt !== undefined) { columns.push("completed_at=?"); values.push(patch.completedAt); }
  columns.push("updated_at=?");
  values.push(patch.now);
  values.push(assignmentId);
  db.prepare(`UPDATE task_assignments SET ${columns.join(", ")} WHERE id=?`).run(...values);
}

function dependenciesAreComplete(db: Database.Database, dependencyIds: string[]) {
  if (!dependencyIds.length) return true;
  const placeholders = dependencyIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id,status FROM task_assignments WHERE id IN (${placeholders})`).all(...dependencyIds) as Array<{ id: string; status: string }>;
  return rows.length === dependencyIds.length && rows.every((row) => row.status === "COMPLETED");
}

export function updateAssignmentLifecycle(db: Database.Database, assignmentId: string, action: SpecialistAssignmentAction, now: string) {
  if (!hasTable(db, "task_assignments")) throw new MediaStudioError("Specialist assignment not found", 404);
  const assignment = db.prepare(`SELECT id,task_id AS taskId,role,status,attempts,dependency_assignment_ids_json AS dependencyAssignmentIdsJson,risk_level AS riskLevel
    FROM task_assignments WHERE id=?`).get(assignmentId) as { id: string; taskId: string; role: string; status: SpecialistAssignmentStatus; attempts: number; dependencyAssignmentIdsJson: string; riskLevel: string } | undefined;
  if (!assignment) throw new MediaStudioError("Specialist assignment not found", 404);
  const dependencies = safeJsonArray(assignment.dependencyAssignmentIdsJson) as string[];
  if ((action === "resume" || action === "retry") && !dependenciesAreComplete(db, dependencies)) {
    db.prepare("UPDATE task_assignments SET status='BLOCKED',updated_at=? WHERE id=?").run(now, assignmentId);
    throw new MediaStudioError("Assignment dependencies must complete before this action", 409);
  }
  const nextStatus: Record<SpecialistAssignmentAction, SpecialistAssignmentStatus> = {
    pause: "PAUSED",
    resume: "READY",
    retry: "RETRY_REQUIRED",
    cancel: "CANCELLED"
  };
  const attempts = action === "retry" ? assignment.attempts + 1 : assignment.attempts;
  db.prepare("UPDATE task_assignments SET status=?,attempts=?,updated_at=?,completed_at=? WHERE id=?")
    .run(nextStatus[action], attempts, now, action === "cancel" ? now : null, assignmentId);
  return { ...assignment, status: nextStatus[action], attempts };
}

export function reassignTaskAssignment(db: Database.Database, assignmentId: string, specialistAgentId: string, now: string) {
  if (!hasTable(db, "task_assignments")) throw new MediaStudioError("Specialist assignment not found", 404);
  const assignment = db.prepare("SELECT id,task_id AS taskId,role,status,risk_level AS riskLevel,dependency_assignment_ids_json AS dependencyAssignmentIdsJson FROM task_assignments WHERE id=?").get(assignmentId) as { id: string; taskId: string; role: string; status: string; riskLevel: string; dependencyAssignmentIdsJson: string } | undefined;
  if (!assignment) throw new MediaStudioError("Specialist assignment not found", 404);
  const agent = db.prepare("SELECT id,role,status FROM agents WHERE id=?").get(specialistAgentId) as { id: string; role: string; status: string } | undefined;
  if (!agent || agent.status !== "ACTIVE") throw new MediaStudioError("Replacement specialist agent is not active", 400);
  if (agent.role !== assignment.role) throw new MediaStudioError("Replacement specialist must have the same role", 400);
  const dependencies = safeJsonArray(assignment.dependencyAssignmentIdsJson) as string[];
  if (!dependenciesAreComplete(db, dependencies)) throw new MediaStudioError("Assignment dependencies must complete before reassignment", 409);
  db.prepare("UPDATE task_assignments SET specialist_agent_id=?,status='RETRY_REQUIRED',attempts=attempts+1,updated_at=? WHERE id=?").run(specialistAgentId, now, assignmentId);
  return assignment;
}

export function detectProposalConflicts(db: Database.Database, taskId: string, taskRoundId?: string | null) {
  if (!hasTable(db, "change_proposals")) return [];
  const hasTaskRoundColumn = hasColumn(db, "change_proposals", "task_round_id");
  const ownerColumns = `${hasColumn(db, "change_proposals", "agent_id") ? ",agent_id AS agentId" : ",NULL AS agentId"}${hasColumn(db, "change_proposals", "task_assignment_id") ? ",task_assignment_id AS taskAssignmentId" : ",NULL AS taskAssignmentId"}`;
  const query = hasTaskRoundColumn && taskRoundId
    ? `SELECT id,file_path AS filePath,proposed_content AS proposedContent,status${ownerColumns} FROM change_proposals WHERE task_id=? AND task_round_id=? AND status!='REJECTED' ORDER BY created_at`
    : `SELECT id,file_path AS filePath,proposed_content AS proposedContent,status${ownerColumns} FROM change_proposals WHERE task_id=? AND status!='REJECTED' ORDER BY created_at`;
  const rows = (hasTaskRoundColumn && taskRoundId ? db.prepare(query).all(taskId, taskRoundId) : db.prepare(query).all(taskId)) as Array<{ id: string; filePath: string; proposedContent: string | null; agentId: string | null; taskAssignmentId: string | null; status: string }>;
  const conflicts: Array<{ filePath: string; proposalIds: string[]; agentIds: string[]; taskAssignmentIds: string[] }> = [];
  const byPath = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byPath.get(row.filePath) ?? [];
    group.push(row);
    byPath.set(row.filePath, group);
  }
  for (const [filePath, group] of byPath) {
    const contents = new Set(group.map((row) => row.proposedContent ?? ""));
    const owners = new Set(group.map((row) => row.agentId ?? row.taskAssignmentId ?? "developer"));
    if (group.length > 1 && contents.size > 1 && owners.size > 1) {
      conflicts.push({
        filePath,
        proposalIds: group.map((row) => row.id),
        agentIds: Array.from(new Set(group.map((row) => row.agentId).filter((value): value is string => Boolean(value)))),
        taskAssignmentIds: Array.from(new Set(group.map((row) => row.taskAssignmentId).filter((value): value is string => Boolean(value))))
      });
    }
  }
  if (conflicts.length && hasTable(db, "task_assignments")) {
    const conflictAssignmentIds = new Set(conflicts.flatMap((conflict) => conflict.taskAssignmentIds));
    for (const assignmentId of conflictAssignmentIds) {
      db.prepare("UPDATE task_assignments SET conflict_state='CONFLICT',status='BLOCKED',updated_at=? WHERE id=?").run(new Date().toISOString(), assignmentId);
    }
  }
  return conflicts;
}

export function taskAssignmentHistory(db: Database.Database, taskId: string) {
  if (!hasTable(db, "task_assignments")) return [];
  const assignments = listTaskAssignments(db, taskId);
  const agents = db.prepare("SELECT id,name,role FROM agents").all() as Array<{ id: string; name: string; role: string }>;
  return assignments.map((assignment) => ({
    ...assignment,
    agent: agents.find((entry) => entry.id === assignment.specialistAgentId) ?? null,
    dependencyAssignmentIds: safeJsonArray(assignment.dependencyAssignmentIdsJson) as string[],
    output: safeJsonObject(assignment.outputJson),
    findings: safeJsonObject(assignment.findingsJson),
    reviewDecisions: safeJsonArray(assignment.reviewDecisionsJson),
    conflicts: getAssignmentConflicts(db, assignment.taskId, assignment.id)
  }));
}

function safeJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getAssignmentConflicts(db: Database.Database, taskId: string, assignmentId: string) {
  if (!hasTable(db, "change_proposals")) return [];
  const assignment = db.prepare("SELECT id,task_round_id AS taskRoundId,role FROM task_assignments WHERE id=?").get(assignmentId) as { id: string; taskRoundId: string | null; role: string } | undefined;
  if (!assignment?.taskRoundId) return [];
  const proposals = db.prepare("SELECT id,file_path AS filePath,proposed_content AS proposedContent,agent_id AS agentId FROM change_proposals WHERE task_id=? AND COALESCE(task_round_id,'')=COALESCE(?, '') ORDER BY created_at").all(taskId, assignment.taskRoundId) as Array<{ id: string; filePath: string; proposedContent: string | null; agentId: string | null }>;
  const conflicts = proposals.filter((proposal, index) => proposals.some((other, otherIndex) => otherIndex > index && other.filePath === proposal.filePath && (other.proposedContent ?? "") !== (proposal.proposedContent ?? "") && (other.agentId ?? "") !== (proposal.agentId ?? "")));
  return conflicts.map((proposal) => ({ filePath: proposal.filePath, proposalId: proposal.id, agentId: proposal.agentId }));
}
