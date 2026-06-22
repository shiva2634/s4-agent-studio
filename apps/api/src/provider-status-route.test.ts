import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const { app } = await import("./server.js");

const originalEnv = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
  PROVIDER_OPENAI_ENABLED: process.env.PROVIDER_OPENAI_ENABLED,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL,
  PROVIDER_NVIDIA_ENABLED: process.env.PROVIDER_NVIDIA_ENABLED,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_BASE_URL: process.env.NVIDIA_BASE_URL,
  NVIDIA_DEFAULT_MODEL: process.env.NVIDIA_DEFAULT_MODEL
};

after(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.AI_PROVIDER = originalEnv.AI_PROVIDER;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_TIMEOUT_MS = originalEnv.AI_TIMEOUT_MS;
  process.env.PROVIDER_OPENAI_ENABLED = originalEnv.PROVIDER_OPENAI_ENABLED;
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
  process.env.OPENAI_DEFAULT_MODEL = originalEnv.OPENAI_DEFAULT_MODEL;
  process.env.PROVIDER_NVIDIA_ENABLED = originalEnv.PROVIDER_NVIDIA_ENABLED;
  process.env.NVIDIA_API_KEY = originalEnv.NVIDIA_API_KEY;
  process.env.NVIDIA_BASE_URL = originalEnv.NVIDIA_BASE_URL;
  process.env.NVIDIA_DEFAULT_MODEL = originalEnv.NVIDIA_DEFAULT_MODEL;
  await app.close();
});

describe("provider status route", () => {
  it("returns App Studio OpenAI status when the fallback config is complete", async () => {
    process.env.AI_PROVIDER = "disabled";
    process.env.PROVIDER_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "openai-live-secret";
    process.env.OPENAI_DEFAULT_MODEL = "gpt-5.5";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    const response = await app.inject({ method: "GET", url: "/api/providers/status" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { provider: string; configured: boolean; configSource: string; blockers: string[]; keyConfigured: boolean; model: string };
    assert.equal(body.provider, "openai_compatible");
    assert.equal(body.configured, true);
    assert.equal(body.configSource, "app_studio_openai");
    assert.equal(body.keyConfigured, true);
    assert.equal(body.model, "gpt-5.5");
    assert.ok(Array.isArray(body.blockers));
    assert.equal(JSON.stringify(body).includes("openai-live-secret"), false);
  });

  it("returns disabled status with blockers when the fallback model is missing", async () => {
    process.env.AI_PROVIDER = "disabled";
    process.env.PROVIDER_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "openai-live-secret";
    delete process.env.OPENAI_DEFAULT_MODEL;
    const response = await app.inject({ method: "GET", url: "/api/providers/status" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { provider: string; configured: boolean; configSource: string; blockers: string[] };
    assert.equal(body.provider, "disabled");
    assert.equal(body.configured, false);
    assert.equal(body.configSource, "disabled");
    assert.ok(body.blockers.some((blocker) => blocker.includes("missing OPENAI_DEFAULT_MODEL")));
  });
});
