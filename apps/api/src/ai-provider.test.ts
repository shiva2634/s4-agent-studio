import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadProviderConfig, providerStatusResponse, sanitizeProviderError, validateCodeProposalOutput } from "./ai-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { insertProposal } from "./change-proposals.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE change_proposals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      original_content TEXT,
      original_content_hash TEXT,
      proposed_content TEXT,
      unified_diff TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ai-provider-"));
  await fs.writeFile(path.join(root, "existing.ts"), "export const before = true;\n", "utf8");
  return root;
}

function validOutput(pathName = "new-file.ts") {
  return {
    summary: "Add feature",
    plan: ["Create the file"],
    proposals: [{ relativePath: pathName, operation: "CREATE", proposedContent: "export const value = true;\n", reason: "Add requested feature" }],
    assumptions: [],
    requiredTests: ["Run typecheck"],
    warnings: []
  };
}

describe("AI provider configuration and validation", () => {
  it("disabled provider configuration keeps planning-only mode available", () => {
    const config = loadProviderConfig({ AI_PROVIDER: "disabled" });
    assert.equal(config.provider, "disabled");
    assert.equal(config.configured, false);
  });

  it("loads NVIDIA provider configuration without hardcoding a model", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "nvidia",
      AI_API_KEY: "test-secret-key",
      AI_MODEL: "nvidia/custom-model",
      AI_TIMEOUT_MS: "1234",
      AI_MAX_RETRIES: "2",
      AI_MAX_PROPOSAL_FILES: "3",
      AI_MAX_OUTPUT_BYTES: "4567"
    });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, "https://integrate.api.nvidia.com/v1");
    assert.equal(config.model, "nvidia/custom-model");
    assert.equal(config.timeoutMs, 1234);
    assert.equal(config.maxRetries, 2);
    assert.equal(config.maxProposalFiles, 3);
    assert.equal(config.maxOutputBytes, 4567);
  });

  it("keeps explicit legacy openai_compatible configuration working", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "openai_compatible",
      AI_API_KEY: "legacy-openai-secret",
      AI_MODEL: "gpt-5.5",
      AI_BASE_URL: "https://legacy.openai.test/v1",
      AI_TIMEOUT_MS: "2345"
    });
    assert.equal(config.provider, "openai_compatible");
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, "legacy-openai-secret");
    assert.equal(config.baseUrl, "https://legacy.openai.test/v1");
    assert.equal(config.model, "gpt-5.5");
    assert.equal(config.timeoutMs, 2345);
  });

  it("keeps explicit legacy nvidia configuration working", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "nvidia",
      AI_API_KEY: "legacy-nvidia-secret",
      AI_MODEL: "nvidia/custom-model",
      AI_BASE_URL: "https://legacy.nvidia.test/v1",
      AI_TIMEOUT_MS: "3456"
    });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, "legacy-nvidia-secret");
    assert.equal(config.baseUrl, "https://legacy.nvidia.test/v1");
    assert.equal(config.model, "nvidia/custom-model");
    assert.equal(config.timeoutMs, 3456);
  });

  it("falls back to App Studio OpenAI provider config when legacy provider is disabled", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "disabled",
      PROVIDER_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "openai-fallback-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-5.5",
      PROVIDER_REQUEST_TIMEOUT_MS: "4321"
    });
    assert.equal(config.provider, "openai_compatible");
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, "openai-fallback-secret");
    assert.equal(config.baseUrl, "https://api.openai.com/v1");
    assert.equal(config.model, "gpt-5.5");
    assert.equal(config.timeoutMs, 4321);
  });

  it("falls back to App Studio OpenAI provider config when legacy provider is missing", () => {
    const config = loadProviderConfig({
      PROVIDER_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "openai-fallback-secret",
      OPENAI_DEFAULT_MODEL: "gpt-5.5"
    });
    assert.equal(config.provider, "openai_compatible");
    assert.equal(config.configured, true);
  });

  it("stays disabled when OpenAI fallback is missing a model", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "disabled",
      PROVIDER_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "openai-fallback-secret"
    });
    assert.equal(config.provider, "disabled");
    assert.equal(config.configured, false);
  });

  it("falls back to App Studio NVIDIA provider config when OpenAI is unavailable", () => {
    const config = loadProviderConfig({
      AI_PROVIDER: "disabled",
      PROVIDER_NVIDIA_ENABLED: "true",
      NVIDIA_API_KEY: "nvidia-fallback-secret",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
      NVIDIA_DEFAULT_MODEL: "nvidia/llama-3.1"
    });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, "nvidia-fallback-secret");
    assert.equal(config.baseUrl, "https://integrate.api.nvidia.com/v1");
    assert.equal(config.model, "nvidia/llama-3.1");
  });

  it("never exposes API keys through provider status", () => {
    const config = loadProviderConfig({ AI_PROVIDER: "nvidia", AI_API_KEY: "super-secret", AI_MODEL: "model" });
    const status = providerStatusResponse(config, { status: "error", lastTestedAt: "now", sanitizedError: sanitizeProviderError("Bearer super-secret failed") });
    const serialized = JSON.stringify(status);
    assert.doesNotMatch(serialized, /super-secret/);
    assert.match(serialized, /\[redacted\]/);
  });

  it("never exposes API keys in disabled provider status", () => {
    const config = loadProviderConfig({ AI_PROVIDER: "disabled" });
    const status = providerStatusResponse(config, null);
    const serialized = JSON.stringify(status);
    assert.doesNotMatch(serialized, /AI_API_KEY|OPENAI_API_KEY|NVIDIA_API_KEY/);
    assert.equal(status.status, "disabled");
    assert.equal(status.configured, false);
  });

  it("uses mocked chat completions for NVIDIA-compatible provider calls", async () => {
    const config = loadProviderConfig({ AI_PROVIDER: "nvidia", AI_API_KEY: "secret", AI_MODEL: "exact-model" });
    let requestedModel = "";
    const provider = new OpenAiCompatibleProvider(config, (async (_url, init) => {
      requestedModel = JSON.parse(String(init?.body)).model;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validOutput()) } }] }), { status: 200 });
    }) as typeof fetch);
    const output = await provider.generateCodeProposal({
      projectName: "Project",
      projectSummary: "Summary",
      userObjective: "Build feature",
      taskCategory: "frontend feature",
      riskLevel: "medium",
      relevantFiles: [],
      fileContents: {},
      existingConventions: [],
      acceptanceCriteria: [],
      securityRequirements: [],
      testingRequirements: [],
      forbiddenPaths: [],
      maximumFiles: 2,
      maximumOutputBytes: 10_000
    });
    assert.equal(requestedModel, "exact-model");
    assert.equal(output.proposals[0].relativePath, "new-file.ts");
  });

  it("rejects malformed provider JSON", async () => {
    const root = await fixture();
    assert.throws(() => validateCodeProposalOutput({ summary: "", plan: [], proposals: [] }, root, { maximumFiles: 2, maximumOutputBytes: 10_000 }));
  });

  it("rejects unsafe provider paths", async () => {
    const root = await fixture();
    assert.throws(() => validateCodeProposalOutput(validOutput("../outside.ts"), root, { maximumFiles: 2, maximumOutputBytes: 10_000 }), /traversal|relative|outside/);
  });

  it("rejects .env proposals", async () => {
    const root = await fixture();
    assert.throws(() => validateCodeProposalOutput(validOutput(".env"), root, { maximumFiles: 2, maximumOutputBytes: 10_000 }), /Secret files/);
  });

  it("rejects DELETE proposals", async () => {
    const root = await fixture();
    assert.throws(() => validateCodeProposalOutput({ ...validOutput(), proposals: [{ ...validOutput().proposals[0], operation: "DELETE" }] }, root, { maximumFiles: 2, maximumOutputBytes: 10_000 }));
  });

  it("rejects excessive proposal count", async () => {
    const root = await fixture();
    const output = { ...validOutput(), proposals: [validOutput("a.ts").proposals[0], validOutput("b.ts").proposals[0], validOutput("c.ts").proposals[0]] };
    assert.throws(() => validateCodeProposalOutput(output, root, { maximumFiles: 2, maximumOutputBytes: 10_000 }), /too many/);
  });

  it("rejects oversized output", async () => {
    const root = await fixture();
    assert.throws(() => validateCodeProposalOutput(validOutput(), root, { maximumFiles: 2, maximumOutputBytes: 20 }), /byte limit/);
  });

  it("stores a valid CREATE proposal without applying it", async () => {
    const root = await fixture();
    const db = createDb();
    const output = validateCodeProposalOutput(validOutput("created.ts"), root, { maximumFiles: 2, maximumOutputBytes: 10_000 });
    await insertProposal(db, {
      id: "proposal-1",
      taskId: "task-1",
      projectId: "project-1",
      rootPath: root,
      filePath: output.proposals[0].relativePath,
      operation: output.proposals[0].operation,
      proposedContent: output.proposals[0].proposedContent,
      reason: output.proposals[0].reason,
      now: "now"
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals").get() as { count: number }).count, 1);
    await assert.rejects(() => fs.readFile(path.join(root, "created.ts"), "utf8"));
  });

  it("stores a valid UPDATE proposal with a diff", async () => {
    const root = await fixture();
    const db = createDb();
    const output = validateCodeProposalOutput({ ...validOutput("existing.ts"), proposals: [{ relativePath: "existing.ts", operation: "UPDATE", proposedContent: "export const after = true;\n", reason: "Update file" }] }, root, { maximumFiles: 2, maximumOutputBytes: 10_000 });
    await insertProposal(db, {
      id: "proposal-1",
      taskId: "task-1",
      projectId: "project-1",
      rootPath: root,
      filePath: output.proposals[0].relativePath,
      operation: output.proposals[0].operation,
      proposedContent: output.proposals[0].proposedContent,
      reason: output.proposals[0].reason,
      now: "now"
    });
    const row = db.prepare("SELECT unified_diff AS diff FROM change_proposals").get() as { diff: string };
    assert.match(row.diff, /-export const before = true;/);
    assert.match(row.diff, /\+export const after = true;/);
  });

  it("provider failure creates no proposals and sanitized audit-style errors contain no secrets", async () => {
    const db = createDb();
    const error = sanitizeProviderError("Request failed with Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
    assert.doesNotMatch(error, /abcdefghijklmnopqrstuvwxyz123456/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM change_proposals").get() as { count: number }).count, 0);
  });
});
