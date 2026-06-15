import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadProviderConfig } from "./ai-provider.js";
import { NvidiaVideoDirectorProvider, type VideoDirectorPlan } from "./media-director-provider.js";

const plan: VideoDirectorPlan = {
  brief: {
    title: "NVIDIA Plan",
    logline: "A concise launch film.",
    audience: "Customers",
    style: "Cinematic",
    durationSeconds: 30,
    constraints: ["Use approved assets"]
  },
  script: "Opening narration.",
  scenes: [{
    title: "Opening",
    description: "Open on the product.",
    durationSeconds: 10,
    dialogue: "Meet the studio.",
    visualPrompt: "Cinematic product reveal in a clean workspace.",
    aspectRatio: "16:9",
    assetLabel: "Opening reference"
  }]
};

const config = loadProviderConfig({
  AI_PROVIDER: "nvidia",
  AI_API_KEY: "test-key",
  AI_BASE_URL: "https://integrate.api.nvidia.com/v1",
  AI_MODEL: "nvidia/test",
  AI_TIMEOUT_MS: "50",
  AI_MAX_RETRIES: "0"
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("NVIDIA video director provider", () => {
  it("parses strict JSON plans and usage from OpenAI-compatible responses", async () => {
    const provider = new NvidiaVideoDirectorProvider(config, async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-key");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(plan) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      });
    });

    const result = await provider.generatePlan({ projectName: "Project", projectDescription: null, userIdea: "Make a launch film", existingContext: {} });

    assert.equal(result.provider, "nvidia");
    assert.equal(result.model, "nvidia/test");
    assert.equal(result.usage?.totalTokens, 30);
    assert.equal(result.value.scenes[0]?.visualPrompt, "Cinematic product reveal in a clean workspace.");
  });

  it("rejects invalid JSON and schema violations", async () => {
    const invalidJson = new NvidiaVideoDirectorProvider(config, async () => jsonResponse({ choices: [{ message: { content: "{bad" } }] }));
    await assert.rejects(() => invalidJson.generatePlan({ projectName: "Project", projectDescription: null, userIdea: "Idea", existingContext: {} }), SyntaxError);

    const invalidSchema = new NvidiaVideoDirectorProvider(config, async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ ...plan, scenes: [] }) } }] }));
    await assert.rejects(() => invalidSchema.generatePlan({ projectName: "Project", projectDescription: null, userIdea: "Idea", existingContext: {} }), /Too small|Array must contain/);
  });

  it("reports timeout without exposing API keys", async () => {
    const provider = new NvidiaVideoDirectorProvider({ ...config, timeoutMs: 1 }, async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted with key test-key"), { name: "AbortError" })));
      });
      return jsonResponse({});
    });

    await assert.rejects(() => provider.generatePlan({ projectName: "Project", projectDescription: null, userIdea: "Idea", existingContext: {} }), /timed out/);
  });

  it("tests connection through the same OpenAI-compatible endpoint", async () => {
    const provider = new NvidiaVideoDirectorProvider(config, async () => jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    const health = await provider.testConnection();
    assert.equal(health.status, "ok");
  });
});
