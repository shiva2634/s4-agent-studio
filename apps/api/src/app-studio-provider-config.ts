type ProviderKey = "openai" | "nvidia";

type ProviderUseCase =
  | "text"
  | "prompt"
  | "compliance"
  | "scripts"
  | "captions"
  | "hooks"
  | "hashtags"
  | "language_adaptation"
  | "monetization_scoring"
  | "ad_copy"
  | "vision"
  | "fallback"
  | "creative";

type ProviderRuntimeStatus = "READY" | "WARN" | "BLOCKED" | "DISABLED";

export type AppStudioProviderRuntimeConfig = {
  providerKey: ProviderKey;
  displayName: string;
  baseUrl: string;
  baseUrlHostname: string;
  enabled: boolean;
  keyConfigured: boolean;
  defaultModel: string;
  scriptModel: string;
  promptModel: string;
  useCases: ProviderUseCase[];
  plannedUses: string[];
  timeoutMs: number;
  dailyCreditLimit: number | null;
  humanApprovalRequired: boolean;
  status: ProviderRuntimeStatus;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
};

export type AppStudioProviderStatus = {
  workspace: "App Studio";
  internalOnly: true;
  summary: string;
  warnings: string[];
  providers: AppStudioProviderRuntimeConfig[];
};

const providerUseCaseMatrix: Record<ProviderKey, ProviderUseCase[]> = {
  openai: ["text", "prompt", "compliance", "scripts", "captions", "hooks", "hashtags", "language_adaptation", "monetization_scoring", "ad_copy"],
  nvidia: ["text", "vision", "fallback", "creative"]
};

const providerPlannedUses: Record<ProviderKey, string[]> = {
  openai: [
    "scripts",
    "prompts",
    "captions",
    "hooks",
    "hashtags",
    "language adaptation",
    "monetization scoring",
    "compliance checks",
    "ad copy"
  ],
  nvidia: [
    "fallback LLM",
    "vision tasks",
    "provider redundancy",
    "creative fallback",
    "experimentation"
  ]
};

const providerDisplayNames: Record<ProviderKey, string> = {
  openai: "OpenAI API",
  nvidia: "NVIDIA API / NIM"
};

const providerMessageLabels: Record<ProviderKey, string> = {
  openai: "OpenAI API",
  nvidia: "NVIDIA API"
};

const providerDefaults: Record<ProviderKey, { baseUrl: string; defaultModel: string; scriptModel: string; promptModel: string }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "",
    scriptModel: "",
    promptModel: ""
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "",
    scriptModel: "",
    promptModel: ""
  }
};

const highCostUseCases: ProviderUseCase[] = ["prompt", "compliance"];

export function validateProviderEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const providers = (["openai", "nvidia"] as const).map((providerKey) => getProviderRuntimeConfig(providerKey, env));
  const warnings = providers.flatMap((provider) => provider.warnings);
  return {
    providers,
    warnings
  };
}

export function getInternalProviderStatus(env: NodeJS.ProcessEnv = process.env): AppStudioProviderStatus {
  const validation = validateProviderEnvironment(env);
  return {
    workspace: "App Studio",
    internalOnly: true,
    summary: buildProviderSummary(validation.providers),
    warnings: validation.warnings,
    providers: validation.providers.map(redactProviderConfig)
  };
}

export function getProviderRuntimeConfig(providerKey: ProviderKey, env: NodeJS.ProcessEnv = process.env): AppStudioProviderRuntimeConfig {
  const defaults = providerDefaults[providerKey];
  const displayName = providerDisplayNames[providerKey];
  const enabled = readBoolean(env[`PROVIDER_${providerKey.toUpperCase()}_ENABLED`]);
  const baseUrl = normalizeString(env[`${providerKey.toUpperCase()}_BASE_URL`]) || defaults.baseUrl;
  const defaultModel = normalizeString(env[`${providerKey.toUpperCase()}_DEFAULT_MODEL`]);
  const scriptModel = providerKey === "openai" ? normalizeString(env.OPENAI_SCRIPT_MODEL) : "";
  const promptModel = providerKey === "openai" ? normalizeString(env.OPENAI_PROMPT_MODEL) : "";
  const keyConfigured = Boolean(normalizeString(env[`${providerKey.toUpperCase()}_API_KEY`]));
  const dailyCreditLimit = parseNumber(env.PROVIDER_DAILY_CREDIT_LIMIT);
  const timeoutMs = parseNumber(env.PROVIDER_REQUEST_TIMEOUT_MS, 30_000) ?? 30_000;
  const baseUrlHostname = getHostname(baseUrl);
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const messageLabel = providerMessageLabels[providerKey];

  if (!enabled) warnings.push(`${messageLabel} is disabled.`);
  if (!keyConfigured) warnings.push(`${messageLabel} key is not configured.`);
  if (!defaultModel) warnings.push(`${messageLabel} default model is not configured.`);
  if (dailyCreditLimit === null) warnings.push("Daily provider credit limit is not configured.");
  if (enabled && !keyConfigured) warnings.push(`${messageLabel} cannot run until an API key is configured.`);

  const status: ProviderRuntimeStatus = !enabled
    ? keyConfigured ? "DISABLED" : "WARN"
    : !keyConfigured ? "BLOCKED"
    : !defaultModel ? "WARN"
    : "READY";

  return {
    providerKey,
    displayName,
    baseUrl,
    baseUrlHostname,
    enabled,
    keyConfigured,
    defaultModel,
    scriptModel,
    promptModel,
    useCases: providerUseCaseMatrix[providerKey],
    plannedUses: providerPlannedUses[providerKey],
    timeoutMs,
    dailyCreditLimit,
    humanApprovalRequired: true,
    status,
    warnings,
    createdAt: now,
    updatedAt: now
  };
}

export function redactProviderConfig(config: AppStudioProviderRuntimeConfig): AppStudioProviderRuntimeConfig {
  return {
    ...config,
    baseUrl: config.baseUrl,
    baseUrlHostname: config.baseUrlHostname,
    defaultModel: config.defaultModel,
    scriptModel: config.scriptModel,
    promptModel: config.promptModel
  };
}

export function assertProviderEnabledForUseCase(providerKey: ProviderKey, useCase: ProviderUseCase, env: NodeJS.ProcessEnv = process.env) {
  const config = getProviderRuntimeConfig(providerKey, env);
  const messageLabel = providerMessageLabels[providerKey];
  if (!config.enabled) throw new Error(`${config.displayName} is disabled`);
  if (!config.keyConfigured) throw new Error(`${messageLabel} is missing an API key`);
  if (!config.defaultModel) throw new Error(`${messageLabel} default model is missing`);
  if (!config.useCases.includes(useCase)) throw new Error(`${messageLabel} does not support ${useCase} use cases`);
  if (highCostUseCases.includes(useCase) && !config.humanApprovalRequired) throw new Error(`${messageLabel} high-cost usage requires human approval`);
  return config;
}

function buildProviderSummary(providers: AppStudioProviderRuntimeConfig[]) {
  const readyCount = providers.filter((provider) => provider.status === "READY").length;
  if (readyCount === providers.length) return "OpenAI is the primary provider and NVIDIA is the fallback. Both provider foundations are configured for internal use.";
  if (readyCount > 0) return "OpenAI and NVIDIA provider foundations are partially configured. Review warnings before enabling paid usage.";
  return "OpenAI and NVIDIA provider foundations are not enabled yet. Configure environment variables before using paid providers.";
}

function getHostname(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "invalid-url";
  }
}

function normalizeString(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : "";
}

function parseNumber(value: string | undefined, fallback: number | null = null) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined) {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}
