import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { MediaStudioError } from "./media-studio.js";
import { taskAssignmentHistory } from "./specialist-orchestration.js";

export type TaskRoundStatus =
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "RUNNING"
  | "TESTING"
  | "FAILED"
  | "FAILED_VALIDATION"
  | "COMPLETED"
  | "CANCELLED"
  | "ROLLED_BACK";

export type TaskRoundType = "INITIAL" | "CONTINUATION" | "CORRECTION" | "RECOVERY";

type TaskRow = {
  id: string;
  projectId: string;
  projectName: string;
  conversationId: string | null;
  title: string;
  objective: string;
  status: string;
  riskLevel: string;
  planJson: string;
  acceptanceCriteria: string | null;
  rollbackPlan: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskRoundRow = {
  id: string;
  taskId: string;
  roundNumber: number;
  roundType: TaskRoundType;
  status: TaskRoundStatus;
  summary: string;
  userMessage: string;
  contextJson: string;
  approvalRequired: number;
  proposalCount: number;
  nextRequiredAction: string;
  checkResultsJson: string | null;
  failureSummary: string | null;
  recoveryAvailable: number;
  recoveryStatus: string | null;
  recoveryOutcome: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ProposalRow = {
  id: string;
  taskId: string;
  taskRoundId: string | null;
  filePath: string;
  operation: string;
  originalContent: string | null;
  reason: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ApprovalRow = {
  id: string;
  taskId: string;
  taskRoundId: string | null;
  actionType: string;
  summary: string;
  status: string;
  riskLevel: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

type ExecutionRow = {
  id: string;
  taskId: string;
  taskRoundId: string | null;
  status: string;
  checkResultsJson: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskContextSummary = {
  taskId: string;
  projectId: string;
  projectName: string;
  taskStatus: string;
  attemptCount: number;
  correctionRounds: number;
  nextRequiredAction: string;
  currentRound: {
    id: string;
    roundNumber: number;
    roundType: TaskRoundType;
    status: TaskRoundStatus;
    approvalRequired: boolean;
    proposalCount: number;
    nextRequiredAction: string;
    recoveryAvailable: boolean;
    recoveryStatus: string | null;
    recoveryOutcome: string | null;
  } | null;
  rounds: Array<{
    id: string;
    roundNumber: number;
    roundType: TaskRoundType;
    status: TaskRoundStatus;
    summary: string;
    userMessage: string;
    proposalCount: number;
    approvalRequired: boolean;
    nextRequiredAction: string;
    recoveryAvailable: boolean;
    recoveryStatus: string | null;
    recoveryOutcome: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    proposals: Array<{ id: string; filePath: string; operation: string; status: string; reason: string; createdAt: string; updatedAt: string }>;
    approvals: Array<{ id: string; actionType: string; summary: string; status: string; riskLevel: string; createdAt: string; decidedAt: string | null; decisionNote: string | null }>;
    executions: Array<{ id: string; status: string; checkResultsJson: string | null; error: string | null; createdAt: string; updatedAt: string }>;
  }>;
  approvedDecisions: Array<{ id: string; actionType: string; status: string; summary: string; decidedAt: string | null }>;
  checkFailures: Array<{ executionId: string; status: string; checkResultsJson: string | null; error: string | null; createdAt: string }>;
  priorProposals: Array<{ id: string; roundNumber: number; filePath: string; operation: string; status: string; reason: string }>;
  assignments: ReturnType<typeof taskAssignmentHistory>;
};

export type TaskRoundInput = {
  taskId: string;
  userMessage: string;
  summary: string;
  roundType: TaskRoundType;
  status: TaskRoundStatus;
  context: Record<string, unknown>;
  approvalRequired: boolean;
  nextRequiredAction: string;
  now: string;
};

function getTaskRow(db: Database.Database, taskId: string) {
  return db.prepare(`SELECT t.id,t.project_id AS projectId,p.name AS projectName,t.conversation_id AS conversationId,t.title,t.objective,t.status,t.risk_level AS riskLevel,t.plan_json AS planJson,t.acceptance_criteria AS acceptanceCriteria,t.rollback_plan AS rollbackPlan,t.created_at AS createdAt,t.updated_at AS updatedAt
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(taskId) as TaskRow | undefined;
}

function hasTaskRoundsTable(db: Database.Database) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_rounds'").get() as { name: string } | undefined;
  return Boolean(row);
}

function getTaskRounds(db: Database.Database, taskId: string) {
  if (!hasTaskRoundsTable(db)) return [];
  return db.prepare(`SELECT id,task_id AS taskId,round_number AS roundNumber,round_type AS roundType,status,summary,user_message AS userMessage,context_json AS contextJson,approval_required AS approvalRequired,proposal_count AS proposalCount,next_required_action AS nextRequiredAction,check_results_json AS checkResultsJson,failure_summary AS failureSummary,recovery_available AS recoveryAvailable,recovery_status AS recoveryStatus,recovery_outcome AS recoveryOutcome,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM task_rounds WHERE task_id=? ORDER BY round_number ASC, created_at ASC`).all(taskId) as TaskRoundRow[];
}

function getRoundDetails(db: Database.Database, taskId: string) {
  if (!hasTaskRoundsTable(db)) return [];
  const rounds = getTaskRounds(db, taskId);
  const roundIds = rounds.map((round) => round.id);
  const proposals = roundIds.length ? db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,file_path AS filePath,operation,original_content AS originalContent,reason,status,created_at AS createdAt,updated_at AS updatedAt FROM change_proposals WHERE task_id=? ORDER BY created_at ASC`).all(taskId) as ProposalRow[] : [];
  const approvals = roundIds.length ? db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,action_type AS actionType,summary,status,risk_level AS riskLevel,created_at AS createdAt,decided_at AS decidedAt,decision_note AS decisionNote FROM approvals WHERE task_id=? ORDER BY created_at ASC`).all(taskId) as ApprovalRow[] : [];
  const executions = roundIds.length ? db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,status,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at ASC`).all(taskId) as ExecutionRow[] : [];
  return rounds.map((round) => ({
    ...round,
    proposals: proposals.filter((proposal) => proposal.taskRoundId === round.id),
    approvals: approvals.filter((approval) => approval.taskRoundId === round.id),
    executions: executions.filter((execution) => execution.taskRoundId === round.id || (!execution.taskRoundId && execution.taskId === round.taskId))
  }));
}

function taskNextAction(round: TaskRoundRow | undefined, latestExecution: ExecutionRow | undefined) {
  if (!round) return "START_TASK";
  if (round.recoveryAvailable) return "RECOVER_EXECUTION";
  if (round.status === "AWAITING_APPROVAL") return "APPROVE_PROPOSALS";
  if (round.status === "APPROVED") return "APPLY_PROPOSALS";
  if (round.status === "FAILED_VALIDATION") return "REVIEW_CHECK_RESULTS";
  if (round.status === "ROLLED_BACK") return "CONTINUE_CHAT";
  if (round.status === "COMPLETED") return "CONTINUE_CHAT";
  if (latestExecution?.status === "APPLYING") return "RECOVER_EXECUTION";
  return "CONTINUE_CHAT";
}

function roundSummaryFromRows(rounds: TaskRoundRow[], db: Database.Database, taskId: string) {
  const detailedRounds = getRoundDetails(db, taskId);
  const latestRound = rounds[rounds.length - 1];
  const latestExecution = db.prepare("SELECT id,task_id AS taskId,task_round_id AS taskRoundId,status,check_results_json AS checkResultsJson,error,created_at AS createdAt,updated_at AS updatedAt FROM task_executions WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as ExecutionRow | undefined;
  return {
    detailedRounds,
    latestRound,
    latestExecution
  };
}

export function getTaskState(db: Database.Database, taskId: string) {
  const task = getTaskRow(db, taskId);
  if (!task) throw new MediaStudioError("Task not found", 404);
  const rounds = getTaskRounds(db, taskId);
  const { detailedRounds, latestRound, latestExecution } = hasTaskRoundsTable(db) ? roundSummaryFromRows(rounds, db, taskId) : { detailedRounds: [], latestRound: undefined, latestExecution: undefined };
  const attemptCount = rounds.length;
  const correctionRounds = rounds.filter((round) => round.roundType === "CORRECTION").length;
  const recoveryAvailable = Boolean(latestExecution && latestExecution.status === "APPLYING");
  const nextRequiredAction = latestRound ? taskNextAction(latestRound, latestExecution) : "START_TASK";
  return {
    task,
    attemptCount,
    correctionRounds,
    nextRequiredAction,
    latestRound,
    latestExecution,
    recoveryAvailable,
    rounds: detailedRounds
  };
}

export function createTaskRound(db: Database.Database, input: TaskRoundInput) {
  if (!hasTaskRoundsTable(db)) {
    return { id: randomUUID(), roundNumber: 1 };
  }
  const taskState = getTaskState(db, input.taskId);
  const roundNumber = taskState.attemptCount + 1;
  const roundId = randomUUID();
  db.prepare(`INSERT INTO task_rounds (id,task_id,round_number,round_type,status,summary,user_message,context_json,approval_required,proposal_count,next_required_action,recovery_available,recovery_status,recovery_outcome,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(roundId, input.taskId, roundNumber, input.roundType, input.status, input.summary, input.userMessage, JSON.stringify(input.context), input.approvalRequired ? 1 : 0, 0, input.nextRequiredAction, 0, null, null, input.now, input.now);
  return { id: roundId, roundNumber };
}

export function updateTaskRound(db: Database.Database, roundId: string, patch: Partial<{
  status: TaskRoundStatus;
  proposalCount: number;
  nextRequiredAction: string;
  checkResultsJson: string | null;
  failureSummary: string | null;
  recoveryAvailable: boolean;
  recoveryStatus: string | null;
  recoveryOutcome: string | null;
  completedAt: string | null;
}> & { now: string }) {
  if (!hasTaskRoundsTable(db)) return;
  const existing = db.prepare("SELECT id FROM task_rounds WHERE id=?").get(roundId);
  if (!existing) throw new MediaStudioError("Task round not found", 404);
  const columns: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.status) { columns.push("status=?"); values.push(patch.status); }
  if (patch.proposalCount !== undefined) { columns.push("proposal_count=?"); values.push(patch.proposalCount); }
  if (patch.nextRequiredAction !== undefined) { columns.push("next_required_action=?"); values.push(patch.nextRequiredAction); }
  if (patch.checkResultsJson !== undefined) { columns.push("check_results_json=?"); values.push(patch.checkResultsJson); }
  if (patch.failureSummary !== undefined) { columns.push("failure_summary=?"); values.push(patch.failureSummary); }
  if (patch.recoveryAvailable !== undefined) { columns.push("recovery_available=?"); values.push(patch.recoveryAvailable ? 1 : 0); }
  if (patch.recoveryStatus !== undefined) { columns.push("recovery_status=?"); values.push(patch.recoveryStatus); }
  if (patch.recoveryOutcome !== undefined) { columns.push("recovery_outcome=?"); values.push(patch.recoveryOutcome); }
  if (patch.completedAt !== undefined) { columns.push("completed_at=?"); values.push(patch.completedAt); }
  columns.push("updated_at=?");
  values.push(patch.now);
  values.push(roundId);
  db.prepare(`UPDATE task_rounds SET ${columns.join(", ")} WHERE id=?`).run(...values);
}

export function getCurrentTaskRound(db: Database.Database, taskId: string) {
  if (!hasTaskRoundsTable(db)) return undefined;
  return db.prepare(`SELECT id,task_id AS taskId,round_number AS roundNumber,round_type AS roundType,status,summary,user_message AS userMessage,context_json AS contextJson,approval_required AS approvalRequired,proposal_count AS proposalCount,next_required_action AS nextRequiredAction,recovery_available AS recoveryAvailable,recovery_status AS recoveryStatus,recovery_outcome AS recoveryOutcome,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM task_rounds WHERE task_id=? ORDER BY round_number DESC, created_at DESC LIMIT 1`).get(taskId) as TaskRoundRow | undefined;
}

export function buildTaskContext(db: Database.Database, taskId: string) {
  const state = getTaskState(db, taskId);
  const latestRound = state.latestRound;
  const approvals = state.rounds.flatMap((round) => round.approvals.filter((approval) => approval.status === "APPROVED"));
  const checkFailures = state.rounds.flatMap((round) => round.executions.filter((execution) => execution.status === "FAILED_VALIDATION" || execution.status === "FAILED" || execution.status === "CHECKS_FAILED"));
  const priorProposals = state.rounds.flatMap((round) => round.proposals.map((proposal) => ({
    id: proposal.id,
    roundNumber: round.roundNumber,
    filePath: proposal.filePath,
    operation: proposal.operation,
    status: proposal.status,
    reason: proposal.reason
  })));
  return {
    taskId: state.task.id,
    projectId: state.task.projectId,
    projectName: state.task.projectName,
    taskStatus: state.task.status,
    attemptCount: state.attemptCount,
    correctionRounds: state.correctionRounds,
    nextRequiredAction: state.nextRequiredAction,
    currentRound: latestRound ? {
      id: latestRound.id,
      roundNumber: latestRound.roundNumber,
      roundType: latestRound.roundType,
      status: latestRound.status,
      approvalRequired: Boolean(latestRound.approvalRequired),
      proposalCount: latestRound.proposalCount,
      nextRequiredAction: latestRound.nextRequiredAction,
      recoveryAvailable: Boolean(latestRound.recoveryAvailable),
      recoveryStatus: latestRound.recoveryStatus,
      recoveryOutcome: latestRound.recoveryOutcome
    } : null,
    rounds: state.rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      roundType: round.roundType,
      status: round.status,
      summary: round.summary,
      userMessage: round.userMessage,
      proposalCount: round.proposalCount,
      approvalRequired: Boolean(round.approvalRequired),
      nextRequiredAction: round.nextRequiredAction,
      recoveryAvailable: Boolean(round.recoveryAvailable),
      recoveryStatus: round.recoveryStatus,
      recoveryOutcome: round.recoveryOutcome,
      createdAt: round.createdAt,
      updatedAt: round.updatedAt,
      completedAt: round.completedAt,
      proposals: round.proposals.map((proposal) => ({ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, status: proposal.status, reason: proposal.reason, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt })),
      approvals: round.approvals.map((approval) => ({ id: approval.id, actionType: approval.actionType, summary: approval.summary, status: approval.status, riskLevel: approval.riskLevel, createdAt: approval.createdAt, decidedAt: approval.decidedAt, decisionNote: approval.decisionNote })),
      executions: round.executions.map((execution) => ({ id: execution.id, status: execution.status, checkResultsJson: execution.checkResultsJson, error: execution.error, createdAt: execution.createdAt, updatedAt: execution.updatedAt }))
    })),
    approvedDecisions: approvals.map((approval) => ({ id: approval.id, actionType: approval.actionType, status: approval.status, summary: approval.summary, decidedAt: approval.decidedAt })),
    checkFailures: checkFailures.map((execution) => ({ executionId: execution.id, status: execution.status, checkResultsJson: execution.checkResultsJson, error: execution.error, createdAt: execution.createdAt })),
    priorProposals,
    assignments: taskAssignmentHistory(db, taskId)
  } satisfies TaskContextSummary;
}

export function listTaskHistory(db: Database.Database, taskId: string) {
  const state = getTaskState(db, taskId);
  const assignments = taskAssignmentHistory(db, taskId);
  return {
    task: {
      id: state.task.id,
      projectId: state.task.projectId,
      projectName: state.task.projectName,
      title: state.task.title,
      objective: state.task.objective,
      status: state.task.status,
      riskLevel: state.task.riskLevel,
      conversationId: state.task.conversationId,
      attemptCount: state.attemptCount,
      correctionRounds: state.correctionRounds,
      nextRequiredAction: state.nextRequiredAction,
      currentRoundNumber: state.latestRound?.roundNumber ?? null,
      currentRoundStatus: state.latestRound?.status ?? null,
      recoveryAvailable: state.recoveryAvailable,
      recoveryStatus: state.latestRound?.recoveryStatus ?? (state.latestExecution?.status === "APPLYING" ? "INTERRUPTED" : state.latestExecution?.status === "ROLLED_BACK" ? "RECOVERED" : null),
      coordinatorPlan: safePlan(state.task.planJson),
      assignmentCount: assignments.length,
      nextRequiredActionDetail: nextActionDetail(state.nextRequiredAction, assignments)
    },
    rounds: state.rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      roundType: round.roundType,
      status: round.status,
      summary: round.summary,
      userMessage: round.userMessage,
      proposalCount: round.proposalCount,
      approvalRequired: Boolean(round.approvalRequired),
      nextRequiredAction: round.nextRequiredAction,
      recoveryAvailable: Boolean(round.recoveryAvailable),
      recoveryStatus: round.recoveryStatus,
      recoveryOutcome: round.recoveryOutcome,
      createdAt: round.createdAt,
      updatedAt: round.updatedAt,
      completedAt: round.completedAt,
      proposals: round.proposals.map((proposal) => ({ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, status: proposal.status, reason: proposal.reason, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt })),
      approvals: round.approvals.map((approval) => ({ id: approval.id, actionType: approval.actionType, summary: approval.summary, status: approval.status, riskLevel: approval.riskLevel, createdAt: approval.createdAt, decidedAt: approval.decidedAt, decisionNote: approval.decisionNote })),
      executions: round.executions.map((execution) => ({ id: execution.id, status: execution.status, checkResultsJson: execution.checkResultsJson, error: execution.error, createdAt: execution.createdAt, updatedAt: execution.updatedAt }))
    })),
    assignments
  };
}

function safePlan(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function nextActionDetail(nextRequiredAction: string, assignments: ReturnType<typeof taskAssignmentHistory>) {
  const blocked = assignments.filter((assignment) => assignment.status === "BLOCKED" || assignment.conflictState === "CONFLICT");
  if (blocked.length) return `Review ${blocked.length} blocked specialist assignment(s) before applying proposals.`;
  const pending = assignments.filter((assignment) => assignment.status === "PENDING" || assignment.status === "READY" || assignment.status === "RETRY_REQUIRED");
  if (pending.length) return `Resolve ${pending.length} specialist assignment(s), then ${nextRequiredAction.replaceAll("_", " ").toLowerCase()}.`;
  return nextRequiredAction.replaceAll("_", " ");
}

export function summarizeTaskState(db: Database.Database, taskId: string) {
  const state = getTaskState(db, taskId);
  const latestRound = state.latestRound;
  return {
    attemptCount: state.attemptCount,
    correctionRounds: state.correctionRounds,
    currentRoundNumber: latestRound?.roundNumber ?? null,
    currentRoundStatus: latestRound?.status ?? null,
    nextRequiredAction: state.nextRequiredAction,
    recoveryAvailable: state.recoveryAvailable
  };
}
