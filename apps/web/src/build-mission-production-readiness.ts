import { getInternalAuthApiBase } from "./internal-auth";
import type { BuildMissionQueueItem } from "./build-mission-queue";

export const buildMissionProductionReadinessChecklistStatuses = ["DRAFT", "IN_PROGRESS", "FIXES_REQUIRED", "READY_FOR_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export const buildMissionProductionReadinessChecklistItemStatuses = ["NOT_CHECKED", "PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"] as const;
export const buildMissionProductionReadinessChecklistSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type BuildMissionProductionReadinessChecklistStatus = (typeof buildMissionProductionReadinessChecklistStatuses)[number];
export type BuildMissionProductionReadinessChecklistItemStatus = (typeof buildMissionProductionReadinessChecklistItemStatuses)[number];
export type BuildMissionProductionReadinessChecklistSeverity = (typeof buildMissionProductionReadinessChecklistSeverities)[number];

export type BuildMissionProductionReadinessChecklistCreatePayload = {
  readinessOwnerUserId?: string | null;
};

export type BuildMissionProductionReadinessChecklistStatusPayload = {
  readinessStatus: BuildMissionProductionReadinessChecklistStatus;
  note?: string | null;
  readinessOwnerUserId?: string | null;
};

export type BuildMissionProductionReadinessChecklistItemPayload = {
  itemStatus: BuildMissionProductionReadinessChecklistItemStatus;
  severity?: BuildMissionProductionReadinessChecklistSeverity | null;
  evidenceNote?: string | null;
  blockerReason?: string | null;
};

export type BuildMissionProductionReadinessChecklistItem = {
  id: string;
  readinessChecklistId: string;
  itemKey: string;
  itemTitle: string;
  itemDescription: string | null;
  itemStatus: BuildMissionProductionReadinessChecklistItemStatus;
  severity: BuildMissionProductionReadinessChecklistSeverity;
  evidenceNote: string | null;
  blockerReason: string | null;
  checkedByUserId: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type BuildMissionProductionReadinessChecklistSummary = {
  id: string;
  buildMissionId: string;
  executionStatusId: string | null;
  qaChecklistId: string | null;
  readinessStatus: BuildMissionProductionReadinessChecklistStatus;
  readinessOwnerUserId: string | null;
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

export type BuildMissionProductionReadinessChecklistDetail = BuildMissionProductionReadinessChecklistSummary & {
  items: BuildMissionProductionReadinessChecklistItem[];
};

export type BuildMissionProductionReadinessDashboardItem = BuildMissionQueueItem;

export type BuildMissionProductionReadinessDetailItem = Omit<BuildMissionQueueItem, "productionReadinessChecklist"> & {
  productionReadinessChecklist: BuildMissionProductionReadinessChecklistDetail | null;
};

type DashboardListResponse = {
  dashboard?: BuildMissionProductionReadinessDashboardItem[];
};

type DashboardItemResponse = {
  item?: BuildMissionProductionReadinessDetailItem;
  error?: string;
};

function readinessUrl(path: string) {
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

async function postReadinessAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionProductionReadinessDetailItem> {
  const response = await fetch(readinessUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}

async function patchReadinessAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionProductionReadinessDetailItem> {
  const response = await fetch(readinessUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}

export async function listBuildMissionProductionReadinessDashboard(): Promise<BuildMissionProductionReadinessDashboardItem[]> {
  const response = await fetch(readinessUrl("/api/business-control-centre/build-mission-production-readiness"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load production readiness dashboard");
  const body = await readJson(response) as DashboardListResponse;
  return Array.isArray(body.dashboard) ? body.dashboard : [];
}

export async function getBuildMissionProductionReadinessDashboardItem(id: string): Promise<BuildMissionProductionReadinessDetailItem> {
  const response = await fetch(readinessUrl(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}`), {
    credentials: "include"
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : "Unable to load production readiness dashboard item");
  return body.item;
}

export async function createBuildMissionProductionReadinessChecklist(id: string, payload: BuildMissionProductionReadinessChecklistCreatePayload = {}): Promise<BuildMissionProductionReadinessDetailItem> {
  return postReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/create`, payload, "Unable to create production readiness checklist");
}

export async function updateBuildMissionProductionReadinessStatus(id: string, payload: BuildMissionProductionReadinessChecklistStatusPayload): Promise<BuildMissionProductionReadinessDetailItem> {
  return patchReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/status`, payload, "Unable to update production readiness checklist status");
}

export async function updateBuildMissionProductionReadinessItem(id: string, itemId: string, payload: BuildMissionProductionReadinessChecklistItemPayload): Promise<BuildMissionProductionReadinessDetailItem> {
  return patchReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, payload, "Unable to update production readiness checklist item");
}

export async function approveBuildMissionProductionReadiness(id: string, note: string): Promise<BuildMissionProductionReadinessDetailItem> {
  return postReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/approve`, { note }, "Unable to approve production readiness checklist");
}

export async function rejectBuildMissionProductionReadiness(id: string, reason: string): Promise<BuildMissionProductionReadinessDetailItem> {
  return postReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/reject`, { reason }, "Unable to reject production readiness checklist");
}

export async function archiveBuildMissionProductionReadiness(id: string): Promise<BuildMissionProductionReadinessDetailItem> {
  return postReadinessAction(`/api/business-control-centre/build-mission-production-readiness/${encodeURIComponent(id)}/archive`, {}, "Unable to archive production readiness checklist");
}
