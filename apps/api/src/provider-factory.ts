import type { AiProvider, ProviderHealthResult } from "./ai-provider.js";
import { loadProviderConfig, providerStatusResponse, type ProviderConfig } from "./ai-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";

let lastHealth: ProviderHealthResult | null = null;

class DisabledProvider implements AiProvider {
  id = "disabled" as const;
  async generateCodeProposal(): Promise<never> {
    throw new Error("AI provider is disabled");
  }
  async testConnection(): Promise<ProviderHealthResult> {
    return { status: "disabled", lastTestedAt: new Date().toISOString() };
  }
}

export function createAiProvider(config: ProviderConfig = loadProviderConfig(), fetchImpl?: typeof fetch): AiProvider {
  if (!config.configured) return new DisabledProvider();
  if (config.provider === "nvidia" || config.provider === "openai_compatible") return new OpenAiCompatibleProvider(config, fetchImpl);
  return new DisabledProvider();
}

export function getProviderStatus(config: ProviderConfig = loadProviderConfig()) {
  return providerStatusResponse(config, lastHealth);
}

export async function testConfiguredProvider(config: ProviderConfig = loadProviderConfig(), fetchImpl?: typeof fetch) {
  const provider = createAiProvider(config, fetchImpl);
  lastHealth = await provider.testConnection();
  return providerStatusResponse(config, lastHealth);
}
