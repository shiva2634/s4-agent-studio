import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderEnabledForUseCase, getInternalProviderStatus, getProviderRuntimeConfig, redactProviderConfig, validateProviderEnvironment } from "./app-studio-provider-config.js";

describe("App Studio provider foundation", () => {
  it("redacts provider config and keeps secret values out of status output", () => {
    const status = getInternalProviderStatus({
      OPENAI_API_KEY: "openai-secret-value",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-5.5",
      OPENAI_SCRIPT_MODEL: "gpt-5.5-script",
      OPENAI_PROMPT_MODEL: "gpt-5.5-prompt",
      PROVIDER_OPENAI_ENABLED: "true",
      NVIDIA_API_KEY: "nvidia-secret-value",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
      NVIDIA_DEFAULT_MODEL: "nvidia/llama-3.1",
      PROVIDER_NVIDIA_ENABLED: "true",
      PROVIDER_DAILY_CREDIT_LIMIT: "100",
      PROVIDER_REQUEST_TIMEOUT_MS: "30000"
    });

    const serialized = JSON.stringify(status);
    assert.doesNotMatch(serialized, /openai-secret-value/);
    assert.doesNotMatch(serialized, /nvidia-secret-value/);
    assert.match(serialized, /"keyConfigured":true/);
    assert.match(serialized, /"humanApprovalRequired":true/);
  });

  it("returns safe WARN states when keys are missing", () => {
    const validation = validateProviderEnvironment({
      PROVIDER_OPENAI_ENABLED: "false",
      PROVIDER_NVIDIA_ENABLED: "false"
    });
    const statuses = validation.providers.reduce<Record<string, string>>((accumulator, provider) => {
      accumulator[provider.providerKey] = provider.status;
      return accumulator;
    }, {});

    assert.equal(statuses.openai, "WARN");
    assert.equal(statuses.nvidia, "WARN");
    assert.ok(validation.warnings.some((warning) => warning.includes("OpenAI API key is not configured")));
    assert.ok(validation.warnings.some((warning) => warning.includes("NVIDIA API key is not configured")));
  });

  it("blocks enabled providers without keys and disables unsafe use", () => {
    const provider = getProviderRuntimeConfig("openai", {
      PROVIDER_OPENAI_ENABLED: "true",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-5.5",
      PROVIDER_DAILY_CREDIT_LIMIT: "100",
      PROVIDER_REQUEST_TIMEOUT_MS: "30000"
    });
    assert.equal(provider.status, "BLOCKED");
    assert.throws(() => assertProviderEnabledForUseCase("openai", "prompt", {
      PROVIDER_OPENAI_ENABLED: "false",
      OPENAI_API_KEY: "secret",
      OPENAI_DEFAULT_MODEL: "gpt-5.5"
    }), /disabled/i);
    assert.throws(() => assertProviderEnabledForUseCase("nvidia", "fallback", {
      PROVIDER_NVIDIA_ENABLED: "true",
      NVIDIA_DEFAULT_MODEL: "nvidia/llama-3.1"
    }), /missing an API key/i);
  });

  it("redacts configs without exposing raw values", () => {
    const config = getProviderRuntimeConfig("nvidia", {
      PROVIDER_NVIDIA_ENABLED: "true",
      NVIDIA_API_KEY: "secret",
      NVIDIA_DEFAULT_MODEL: "nvidia/llama",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
      PROVIDER_DAILY_CREDIT_LIMIT: "50",
      PROVIDER_REQUEST_TIMEOUT_MS: "15000"
    });
    const redacted = redactProviderConfig(config);
    assert.equal(redacted.keyConfigured, true);
    assert.equal(redacted.baseUrlHostname, "integrate.api.nvidia.com");
    assert.ok(!JSON.stringify(redacted).includes("secret"));
  });
});
