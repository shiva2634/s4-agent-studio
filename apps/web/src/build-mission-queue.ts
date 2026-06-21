import { getInternalAuthApiBase } from "./internal-auth";
import type { BuildMissionProductionReadinessChecklistSummary } from "./build-mission-production-readiness";

export type BuildMissionQaChecklistStatus = "DRAFT" | "IN_PROGRESS" | "FIXES_REQUESTED" | "READY_FOR_APPROVAL" | "APPROVED" | "REJECTED" | "ARCHIVED";

export type BuildMissionQueueAssignment = {
  id: string;
  assignmentStatus: string;
  managerUserId: string | null;
  teamLeaderUserId: string | null;
  frontendDeveloperUserId: string | null;
  backendDeveloperUserId: string | null;
  qaUserId: string | null;
  productionReadinessUserId: string | null;
  supportOwnerUserId: string | null;
  financeOwnerUserId: string | null;
  hrOwnerUserId: string | null;
  notes: string | null;
  updatedAt: string;
};

export type BuildMissionQueueItem = {
  id: string;
  buildMissionId: string;
  projectId: string;
  taskId: string | null;
  targetModule: string;
  scope: string;
  scopeSummary: string;
  riskLevel: string;
  status: string;
  approvalId: string | null;
  approvalState: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  convertedAt: string | null;
  intake: {
    id: string;
    projectName: string;
    clientOrCompanyName: string;
    prdStatus: string;
    workflowStatus: string;
    shortSummary: string;
    priority: string;
    appStudioBuildMissionId: string;
    handedOffAt: string | null;
    handedOffByUserId: string | null;
  };
  assignment: BuildMissionQueueAssignment | null;
  developmentGate: {
    id: string;
    gateStatus: string;
    requestedByUserId: string;
    approvedByUserId: string | null;
    blockedByUserId: string | null;
    requestNote: string | null;
    approvalNote: string | null;
    blockReason: string | null;
    requestedAt: string;
    approvedAt: string | null;
    blockedAt: string | null;
    updatedAt: string;
  } | null;
  executionStatus: BuildMissionExecutionStatusSummary | null;
  qaChecklist: BuildMissionQaChecklistSummary | null;
  productionReadinessChecklist: BuildMissionProductionReadinessChecklistSummary | null;
};

export type BuildMissionExecutionStatusSummary = {
  id: string;
  executionStatus: string;
  currentStage: string;
  progressPercent: number;
  frontendStatus: string | null;
  backendStatus: string | null;
  qaStatus: string | null;
  productionReadinessStatus: string | null;
  blockerSummary: string | null;
  nextAction: string | null;
  ownerUserId: string | null;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type BuildMissionQaChecklistSummary = {
  id: string;
  buildMissionId: string;
  executionStatusId: string | null;
  qaStatus: BuildMissionQaChecklistStatus;
  qaOwnerUserId: string | null;
  requestedByUserId: string;
  approvedByUserId: string | null;
  rejectedByUserId: string | null;
  approvalNote: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  archivedAt: string | null;
  itemCount: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  notApplicableCount: number;
  notCheckedCount: number;
  readyForApproval: boolean;
};

export type AssignableUser = {
  id: string;
  displayName: string;
  email: string;
  userType: "INTERNAL";
  status: "ACTIVE";
  title: string | null;
  departmentKey: string | null;
  jobRoleKey: string | null;
  roleKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type BuildMissionTeamAssignmentPayload = {
  assignmentStatus: string;
  managerUserId?: string | null;
  teamLeaderUserId?: string | null;
  frontendDeveloperUserId?: string | null;
  backendDeveloperUserId?: string | null;
  qaUserId?: string | null;
  productionReadinessUserId?: string | null;
  supportOwnerUserId?: string | null;
  financeOwnerUserId?: string | null;
  hrOwnerUserId?: string | null;
  notes?: string | null;
};

type QueueListResponse = {
  queue?: BuildMissionQueueItem[];
};

type QueueItemResponse = {
  item?: BuildMissionQueueItem;
  assignment?: BuildMissionQueueAssignment;
  assignmentWarnings?: string[];
  roleFitWarnings?: string[];
  error?: string;
};

type AssignableUsersResponse = {
  users?: AssignableUser[];
};

function queueUrl(path: string) {
  return `${getInternalAuthApiBase()}${path}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function listBuildMissionQueue(): Promise<BuildMissionQueueItem[]> {
  const response = await fetch(queueUrl("/api/business-control-centre/build-mission-queue"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load Build Mission queue");
  const body = await readJson(response) as QueueListResponse;
  return Array.isArray(body.queue) ? body.queue : [];
}

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const response = await fetch(queueUrl("/api/business-control-centre/assignable-users"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load assignable internal users");
  const body = await readJson(response) as AssignableUsersResponse;
  return Array.isArray(body.users) ? body.users : [];
}

export async function approveBuildMissionQueueItem(id: string, note: string): Promise<BuildMissionQueueItem> {
  return postQueueAction(`${id}/approve`, { note }, "Unable to approve Build Mission draft");
}

export async function requestBuildMissionQueueChanges(id: string, reason: string): Promise<BuildMissionQueueItem> {
  return postQueueAction(`${id}/request-changes`, { reason }, "Unable to request Build Mission changes");
}

export async function saveBuildMissionTeamAssignment(id: string, payload: BuildMissionTeamAssignmentPayload): Promise<{ item: BuildMissionQueueItem; assignmentWarnings: string[]; roleFitWarnings: string[] }> {
  const response = await postQueueActionResponse(`${id}/assign-team`, payload, "Unable to save Build Mission team assignment");
  return {
    item: response.item,
    assignmentWarnings: Array.isArray(response.assignmentWarnings) ? response.assignmentWarnings : [],
    roleFitWarnings: Array.isArray(response.roleFitWarnings) ? response.roleFitWarnings : []
  };
}

export async function requestDevelopmentStart(id: string, note: string): Promise<BuildMissionQueueItem> {
  return postQueueAction(`${id}/request-development-start`, { note }, "Unable to request development start");
}

export async function approveDevelopmentStart(id: string, note: string): Promise<BuildMissionQueueItem> {
  return postQueueAction(`${id}/approve-development-start`, { note }, "Unable to approve development start");
}

export async function blockDevelopmentStart(id: string, reason: string): Promise<BuildMissionQueueItem> {
  return postQueueAction(`${id}/block-development-start`, { reason }, "Unable to block development start");
}

async function postQueueAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionQueueItem> {
  const body = await postQueueActionResponse(path, payload, fallback);
  return body.item;
}

async function postQueueActionResponse(path: string, payload: unknown, fallback: string): Promise<QueueItemResponse & { item: BuildMissionQueueItem }> {
  const response = await fetch(queueUrl(`/api/business-control-centre/build-mission-queue/${encodeURIComponent(path.split("/")[0])}/${path.split("/").slice(1).join("/")}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as QueueItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body as QueueItemResponse & { item: BuildMissionQueueItem };
}
