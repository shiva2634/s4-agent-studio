import { getInternalAuthApiBase } from "./internal-auth";

export type AppStudioProviderStatus = {
  workspace: "App Studio";
  internalOnly: true;
  summary: string;
  warnings: string[];
  authenticatedUser?: { id: string; displayName: string };
  providers: Array<{
    providerKey: "openai" | "nvidia";
    displayName: string;
    enabled: boolean;
    keyConfigured: boolean;
    baseUrl: string;
    baseUrlHostname: string;
    defaultModel: string;
    scriptModel: string;
    promptModel: string;
    useCases: string[];
    plannedUses: string[];
    timeoutMs: number;
    dailyCreditLimit: number | null;
    humanApprovalRequired: boolean;
    status: "READY" | "WARN" | "BLOCKED" | "DISABLED";
    warnings: string[];
    createdAt: string;
    updatedAt: string;
  }>;
};

type AppStudioProviderStatusResponse = Partial<AppStudioProviderStatus> & {
  error?: string;
};

function providerStatusUrl(path: string) {
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

export async function getAppStudioProviderStatus(): Promise<AppStudioProviderStatus | null> {
  try {
    const response = await fetch(providerStatusUrl("/api/app-studio/internal/providers/status"), {
      credentials: "include"
    });
    const body = await readJson(response) as AppStudioProviderStatusResponse;
    if (!response.ok) return null;
    return {
      workspace: "App Studio",
      internalOnly: true,
      summary: typeof body.summary === "string" ? body.summary : "Provider foundations are not enabled yet.",
      warnings: Array.isArray(body.warnings) ? body.warnings.filter((warning): warning is string => typeof warning === "string") : [],
      authenticatedUser: typeof body.authenticatedUser?.id === "string" && typeof body.authenticatedUser?.displayName === "string"
        ? { id: body.authenticatedUser.id, displayName: body.authenticatedUser.displayName }
        : undefined,
      providers: Array.isArray(body.providers) ? body.providers.flatMap(normalizeProviderStatus) : []
    };
  } catch {
    return null;
  }
}

function normalizeProviderStatus(value: unknown) {
  const provider = value as AppStudioProviderStatus["providers"][number];
  if (!provider || (provider.providerKey !== "openai" && provider.providerKey !== "nvidia")) return [];
  return [{
    providerKey: provider.providerKey,
    displayName: typeof provider.displayName === "string" ? provider.displayName : provider.providerKey,
    enabled: provider.enabled === true,
    keyConfigured: provider.keyConfigured === true,
    baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
    baseUrlHostname: typeof provider.baseUrlHostname === "string" ? provider.baseUrlHostname : "unknown",
    defaultModel: typeof provider.defaultModel === "string" ? provider.defaultModel : "",
    scriptModel: typeof provider.scriptModel === "string" ? provider.scriptModel : "",
    promptModel: typeof provider.promptModel === "string" ? provider.promptModel : "",
    useCases: Array.isArray(provider.useCases) ? provider.useCases.filter((item): item is string => typeof item === "string") : [],
    plannedUses: Array.isArray(provider.plannedUses) ? provider.plannedUses.filter((item): item is string => typeof item === "string") : [],
    timeoutMs: typeof provider.timeoutMs === "number" ? provider.timeoutMs : 30_000,
    dailyCreditLimit: typeof provider.dailyCreditLimit === "number" ? provider.dailyCreditLimit : null,
    humanApprovalRequired: provider.humanApprovalRequired === true,
    status: provider.status === "READY" || provider.status === "WARN" || provider.status === "BLOCKED" || provider.status === "DISABLED" ? provider.status : "WARN",
    warnings: Array.isArray(provider.warnings) ? provider.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    createdAt: typeof provider.createdAt === "string" ? provider.createdAt : "",
    updatedAt: typeof provider.updatedAt === "string" ? provider.updatedAt : ""
  }];
}
