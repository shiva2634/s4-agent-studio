import { getInternalAuthApiBase } from "./internal-auth";
import type { BuildMissionQaChecklistSummary, BuildMissionQueueItem } from "./build-mission-queue";

export const buildMissionQaChecklistStatuses = ["DRAFT", "IN_PROGRESS", "FIXES_REQUESTED", "READY_FOR_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export const buildMissionQaChecklistItemStatuses = ["NOT_CHECKED", "PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"] as const;
export const buildMissionQaChecklistSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type BuildMissionQaChecklistStatus = (typeof buildMissionQaChecklistStatuses)[number];
export type BuildMissionQaChecklistItemStatus = (typeof buildMissionQaChecklistItemStatuses)[number];
export type BuildMissionQaChecklistSeverity = (typeof buildMissionQaChecklistSeverities)[number];

export type BuildMissionQaChecklistCreatePayload = {
  qaOwnerUserId?: string | null;
};

export type BuildMissionQaChecklistStatusPayload = {
  qaStatus: BuildMissionQaChecklistStatus;
  note?: string | null;
  qaOwnerUserId?: string | null;
};

export type BuildMissionQaChecklistItemPayload = {
  itemStatus: BuildMissionQaChecklistItemStatus;
  severity?: BuildMissionQaChecklistSeverity | null;
  evidenceNote?: string | null;
  blockerReason?: string | null;
};

export type BuildMissionQaChecklistItem = {
  id: string;
  qaChecklistId: string;
  itemKey: string;
  itemTitle: string;
  itemDescription: string | null;
  itemStatus: BuildMissionQaChecklistItemStatus;
  severity: BuildMissionQaChecklistSeverity;
  evidenceNote: string | null;
  blockerReason: string | null;
  checkedByUserId: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type BuildMissionQaChecklistDetail = BuildMissionQaChecklistSummary & {
  items: BuildMissionQaChecklistItem[];
};

export type BuildMissionQaDashboardItem = BuildMissionQueueItem;

export type BuildMissionQaDetailItem = Omit<BuildMissionQueueItem, "qaChecklist"> & {
  qaChecklist: BuildMissionQaChecklistDetail | null;
};

type DashboardListResponse = {
  dashboard?: BuildMissionQaDashboardItem[];
};

type DashboardItemResponse = {
  item?: BuildMissionQaDetailItem;
  error?: string;
};

function qaUrl(path: string) {
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

async function postQaAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionQaDetailItem> {
  const response = await fetch(qaUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}

async function patchQaAction(path: string, payload: unknown, fallback: string): Promise<BuildMissionQaDetailItem> {
  const response = await fetch(qaUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : fallback);
  return body.item;
}

export async function listBuildMissionQaDashboard(): Promise<BuildMissionQaDashboardItem[]> {
  const response = await fetch(qaUrl("/api/business-control-centre/build-mission-qa"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load QA dashboard");
  const body = await readJson(response) as DashboardListResponse;
  return Array.isArray(body.dashboard) ? body.dashboard : [];
}

export async function getBuildMissionQaDashboardItem(id: string): Promise<BuildMissionQaDetailItem> {
  const response = await fetch(qaUrl(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}`), {
    credentials: "include"
  });
  const body = await readJson(response) as DashboardItemResponse;
  if (!response.ok || !body.item) throw new Error(typeof body.error === "string" ? body.error : "Unable to load QA dashboard item");
  return body.item;
}

export async function createBuildMissionQaChecklist(id: string, payload: BuildMissionQaChecklistCreatePayload = {}): Promise<BuildMissionQaDetailItem> {
  return postQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/create`, payload, "Unable to create QA checklist");
}

export async function updateBuildMissionQaChecklistStatus(id: string, payload: BuildMissionQaChecklistStatusPayload): Promise<BuildMissionQaDetailItem> {
  return patchQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/status`, payload, "Unable to update QA checklist status");
}

export async function updateBuildMissionQaChecklistItem(id: string, itemId: string, payload: BuildMissionQaChecklistItemPayload): Promise<BuildMissionQaDetailItem> {
  return patchQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, payload, "Unable to update QA checklist item");
}

export async function approveBuildMissionQaChecklist(id: string, note: string): Promise<BuildMissionQaDetailItem> {
  return postQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/approve`, { note }, "Unable to approve QA checklist");
}

export async function rejectBuildMissionQaChecklist(id: string, reason: string): Promise<BuildMissionQaDetailItem> {
  return postQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/reject`, { reason }, "Unable to reject QA checklist");
}

export async function archiveBuildMissionQaChecklist(id: string): Promise<BuildMissionQaDetailItem> {
  return postQaAction(`/api/business-control-centre/build-mission-qa/${encodeURIComponent(id)}/archive`, {}, "Unable to archive QA checklist");
}
