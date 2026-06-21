import { getInternalAuthApiBase } from "./internal-auth";
import type { BuildMissionQueueItem } from "./build-mission-queue";

export const buildMissionDeploymentApprovalStatuses = ["DRAFT", "REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "ARCHIVED"] as const;

export type BuildMissionDeploymentApprovalStatus = (typeof buildMissionDeploymentApprovalStatuses)[number];

export type BuildMissionDeploymentApprovalSummary = {
  id: string;
  buildMissionId: string;
  productionReadinessChecklistId: string;
  approvalStatus: BuildMissionDeploymentApprovalStatus;
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
};

export type BuildMissionDeploymentApprovalDashboardItem = BuildMissionQueueItem & {
  deploymentApproval?: BuildMissionDeploymentApprovalSummary | null;
};

type DashboardListResponse = {
  dashboard?: BuildMissionDeploymentApprovalDashboardItem[];
};

type DashboardItemResponse = {
  item?: BuildMissionDeploymentApprovalDashboardItem;
  error?: string;
};

function deploymentApprovalUrl(path: string) {
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

async function postDeploymentApprovalAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  const response = await fetch(deploymentApprovalUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}

export async function listBuildMissionDeploymentApprovalDashboard(): Promise<BuildMissionDeploymentApprovalDashboardItem[]> {
  const response = await fetch(deploymentApprovalUrl("/api/business-control-centre/build-mission-deployment-approvals"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load deployment approval dashboard");
  const body = await readJson(response) as DashboardListResponse;
  return Array.isArray(body.dashboard) ? body.dashboard : [];
}

export async function getBuildMissionDeploymentApprovalDashboardItem(id: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  const response = await fetch(deploymentApprovalUrl(`/api/business-control-centre/build-mission-deployment-approvals/${encodeURIComponent(id)}`), {
    credentials: "include"
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : "Unable to load deployment approval dashboard item");
  return body.item;
}

export async function createBuildMissionDeploymentApproval(id: string, note: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  return postDeploymentApprovalAction(`/api/business-control-centre/build-mission-deployment-approvals/${encodeURIComponent(id)}/create`, { note }, "Unable to create deployment approval");
}

export async function approveBuildMissionDeploymentApproval(id: string, note: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  return postDeploymentApprovalAction(`/api/business-control-centre/build-mission-deployment-approvals/${encodeURIComponent(id)}/approve`, { note }, "Unable to approve deployment approval");
}

export async function rejectBuildMissionDeploymentApproval(id: string, reason: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  return postDeploymentApprovalAction(`/api/business-control-centre/build-mission-deployment-approvals/${encodeURIComponent(id)}/reject`, { reason }, "Unable to reject deployment approval");
}

export async function archiveBuildMissionDeploymentApproval(id: string): Promise<BuildMissionDeploymentApprovalDashboardItem> {
  return postDeploymentApprovalAction(`/api/business-control-centre/build-mission-deployment-approvals/${encodeURIComponent(id)}/archive`, {}, "Unable to archive deployment approval");
}
