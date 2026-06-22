import { getInternalAuthApiBase } from "./internal-auth";

export type SocialAutomationSummaryCounts = {
  customers: number;
  contentIdeas: number;
  generationJobs: number;
  complianceItems: number;
  publishingTasks: number;
  metaAdsIntakes: number;
  brandCampaigns: number;
  creditLedgerEntries: number;
  supportTickets: number;
  analyticsEvents: number;
};

export type SocialAutomationSummary = {
  counts: SocialAutomationSummaryCounts;
  warnings: string[];
  authenticatedUser?: { id: string; displayName: string };
};

type SocialAutomationSummaryResponse = Partial<SocialAutomationSummary> & {
  error?: string;
};

function summaryUrl(path: string) {
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

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function normalizeCounts(value: unknown): SocialAutomationSummaryCounts {
  const counts = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    customers: normalizeCount(counts.customers),
    contentIdeas: normalizeCount(counts.contentIdeas),
    generationJobs: normalizeCount(counts.generationJobs),
    complianceItems: normalizeCount(counts.complianceItems),
    publishingTasks: normalizeCount(counts.publishingTasks),
    metaAdsIntakes: normalizeCount(counts.metaAdsIntakes),
    brandCampaigns: normalizeCount(counts.brandCampaigns),
    creditLedgerEntries: normalizeCount(counts.creditLedgerEntries),
    supportTickets: normalizeCount(counts.supportTickets),
    analyticsEvents: normalizeCount(counts.analyticsEvents)
  };
}

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAuthenticatedUser(value: unknown): SocialAutomationSummary["authenticatedUser"] | undefined {
  const user = value as { id?: unknown; displayName?: unknown } | undefined;
  if (!user || typeof user.id !== "string" || typeof user.displayName !== "string") return undefined;
  return { id: user.id, displayName: user.displayName };
}

export function normalizeSocialAutomationSummary(value: unknown): SocialAutomationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as SocialAutomationSummaryResponse;
  return {
    counts: normalizeCounts(response.counts),
    warnings: normalizeWarnings(response.warnings),
    authenticatedUser: normalizeAuthenticatedUser(response.authenticatedUser)
  };
}

export async function getSocialAutomationSummary(): Promise<SocialAutomationSummary> {
  const response = await fetch(summaryUrl("/api/business-control-centre/social-automation/summary"), {
    credentials: "include"
  });
  const body = normalizeSocialAutomationSummary(await readJson(response));
  if (!response.ok || !body) throw new Error("Unable to load Social Automation summary");
  return body;
}
