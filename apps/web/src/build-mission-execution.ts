import { getInternalAuthApiBase } from "./internal-auth";
import type { BuildMissionQueueItem } from "./build-mission-queue";

export const buildMissionExecutionStatuses = ["NOT_STARTED", "READY_TO_START", "IN_PROGRESS", "BLOCKED", "QA_REVIEW", "PRODUCTION_READINESS_REVIEW", "COMPLETED", "CANCELLED"] as const;
export const buildMissionExecutionStages = ["DEVELOPMENT_START_APPROVED", "REQUIREMENTS_REVIEW", "FRONTEND_BUILD", "BACKEND_BUILD", "INTEGRATION", "TESTING_QA", "PRODUCTION_READINESS", "DEPLOYMENT_APPROVAL_PENDING", "COMPLETED"] as const;

export type BuildMissionExecutionPayload = {
  executionStatus?: string;
  currentStage?: string;
  progressPercent?: number;
  frontendStatus?: string | null;
  backendStatus?: string | null;
  qaStatus?: string | null;
  productionReadinessStatus?: string | null;
  blockerSummary?: string | null;
  nextAction?: string | null;
  ownerUserId?: string | null;
};

type DashboardListResponse = {
  dashboard?: BuildMissionQueueItem[];
};

type DashboardItemResponse = {
  item?: BuildMissionQueueItem;
  error?: string;
};

function executionUrl(path: string) {
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

export async function listBuildMissionExecutionDashboard(): Promise<BuildMissionQueueItem[]> {
  const response = await fetch(executionUrl("/api/business-control-centre/build-mission-execution-dashboard"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load Build Mission execution dashboard");
  const body = await readJson(response) as DashboardListResponse;
  return Array.isArray(body.dashboard) ? body.dashboard : [];
}

export async function getBuildMissionExecutionDashboardItem(id: string): Promise<BuildMissionQueueItem> {
  const response = await fetch(executionUrl(`/api/business-control-centre/build-mission-execution-dashboard/${encodeURIComponent(id)}`), {
    credentials: "include"
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : "Unable to load Build Mission execution item");
  return body.item;
}

export async function createBuildMissionExecutionStatus(id: string): Promise<BuildMissionQueueItem> {
  return postExecutionAction(`${id}/create`, {}, "Unable to create Build Mission execution record");
}

export async function updateBuildMissionExecutionStatus(id: string, payload: BuildMissionExecutionPayload): Promise<BuildMissionQueueItem> {
  const response = await fetch(executionUrl(`/api/business-control-centre/build-mission-execution-dashboard/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : "Unable to update Build Mission execution record");
  return body.item;
}

export async function archiveBuildMissionExecutionStatus(id: string): Promise<BuildMissionQueueItem> {
  return postExecutionAction(`${id}/archive`, {}, "Unable to archive Build Mission execution record");
}

async function postExecutionAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionQueueItem> {
  const [id, action] = path.split("/");
  const response = await fetch(executionUrl(`/api/business-control-centre/build-mission-execution-dashboard/${encodeURIComponent(id)}/${action}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}
