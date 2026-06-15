import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { MediaGenerationWorker, getGenerationJob, type GenerationWorkerConfig } from "./media-generation-worker.js";
import { listGenerationStatusHistory } from "./media-generation-history.js";
import type { ExternalMediaConfig, ExternalMediaHttp } from "./ovi-ltx-provider.js";
import type { ProcessRunner } from "./media-processing.js";

const workerConfig: GenerationWorkerConfig = { concurrency: 1, pollingIntervalMs: 5, maxProcessingMs: 5_000 };
const oviConfig: ExternalMediaConfig = { enabled: true, baseUrl: "http://127.0.0.1:8391", apiKey: "secret", timeoutMs: 5_000 };

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_brand_kits (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,colors_json TEXT NOT NULL DEFAULT '[]',fonts_json TEXT NOT NULL DEFAULT '[]',tagline TEXT NOT NULL DEFAULT '',tone TEXT NOT NULL DEFAULT '',disclaimer TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_presenter_profiles (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,appearance_prompt TEXT NOT NULL DEFAULT '',voice_accent TEXT NOT NULL DEFAULT '',clothing TEXT NOT NULL DEFAULT '',consistency_rules TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_status_history (id TEXT PRIMARY KEY,generation_job_id TEXT NOT NULL,status TEXT NOT NULL,progress_percent INTEGER,message TEXT,provider_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE media_processing_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,status TEXT NOT NULL,operation TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-1','Async','', '16:9','ACTIVE','now','now')").run();
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-2','Other','', '16:9','ACTIVE','now','now')").run();
  for (const sceneId of ["scene-1", "scene-2"]) {
    db.prepare("INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,approved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(sceneId, "media-1", "brief-1", sceneId === "scene-1" ? 1 : 2, sceneId, "Desc", 5, "Hello", "Launch prompt", "16:9", "APPROVED", "approved", "now", "now");
  }
  return db;
}

const audit = (db: Database.Database): MediaAuditWriter => (eventType, summary, values = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function processingRunner(storageRoot: string): ProcessRunner {
  return async (_command, args) => {
    if (args.includes("-version")) return { stdout: "version", stderr: "", exitCode: 0 };
    if (args.includes("-show_streams")) return { stdout: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "24/1" }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "5" } }), stderr: "", exitCode: 0 };
    const output = args[args.length - 1];
    if (typeof output === "string" && path.resolve(output).startsWith(path.resolve(storageRoot))) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, "derivative");
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

function delayedProvider() {
  let submitted = 0;
  let completed = false;
  const fetchImpl: ExternalMediaHttp = async (input) => {
    const url = String(input);
    if (url.endsWith("/jobs")) {
      submitted += 1;
      return jsonResponse({ job_id: `remote-${submitted}` });
    }
    if (/\/jobs\/remote-\d+$/.test(url)) return completed ? jsonResponse({ status: "completed", progress: 100, output: { filename: "generated.mp4", url: `${url}/output` } }) : jsonResponse({ status: "running", progress: 25 });
    if (url.endsWith("/output")) return new Response(new Uint8Array(Buffer.from("video")), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, submitted: () => submitted, complete: () => { completed = true; } };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}

describe("media generation worker", () => {
  it("returns a queued job immediately and completes it in the background", async () => {
    const db = dbFixture();
    const provider = delayedProvider();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-worker-"));
    const worker = new MediaGenerationWorker(db, audit(db), workerConfig, { oviConfig, oviFetch: provider.fetchImpl, storageRoot, processOptions: { runner: processingRunner(storageRoot) } });

    const job = worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, now: "now", jobId: "job-1", outputAssetId: "asset-1" });
    assert.equal(job.status, "QUEUED");
    await waitFor(() => provider.submitted() === 1);
    provider.complete();
    await waitFor(() => getGenerationJob(db, "media-1", "job-1").status === "COMPLETED");
    assert.equal(listGenerationStatusHistory(db, "media-1", "job-1").some((entry) => entry.progressPercent === 25), true);
  });

  it("honors concurrency limits and prevents duplicate execution", async () => {
    const db = dbFixture();
    const provider = delayedProvider();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-worker-concurrency-"));
    const worker = new MediaGenerationWorker(db, audit(db), workerConfig, { oviConfig, oviFetch: provider.fetchImpl, storageRoot, processOptions: { runner: processingRunner(storageRoot) } });
    worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, now: "now", jobId: "job-1", outputAssetId: "asset-1" });
    worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-2", task: "T2V", providerKey: "ovi", approved: true, now: "now", jobId: "job-2", outputAssetId: "asset-2" });
    worker.enqueue("job-2");
    await waitFor(() => provider.submitted() === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(provider.submitted(), 1);
    provider.complete();
    await waitFor(() => getGenerationJob(db, "media-1", "job-2").status === "COMPLETED");
    assert.equal(provider.submitted(), 2);
  });

  it("cancels queued and running jobs without late completion overwriting cancellation", async () => {
    const db = dbFixture();
    const provider = delayedProvider();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-worker-cancel-"));
    const worker = new MediaGenerationWorker(db, audit(db), workerConfig, { oviConfig, oviFetch: provider.fetchImpl, storageRoot, processOptions: { runner: processingRunner(storageRoot) } });
    worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, now: "now", jobId: "running-job", outputAssetId: "asset-1" });
    worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-2", task: "T2V", providerKey: "ovi", approved: true, now: "now", jobId: "queued-job", outputAssetId: "asset-2" });
    await waitFor(() => provider.submitted() === 1);
    worker.cancel("media-1", "queued-job", "cancel");
    worker.cancel("media-1", "running-job", "cancel");
    provider.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(getGenerationJob(db, "media-1", "queued-job").status, "CANCELLED");
    assert.equal(getGenerationJob(db, "media-1", "running-job").status, "CANCELLED");
  });

  it("retries failed jobs as new queued attempts", async () => {
    const db = dbFixture();
    const provider = delayedProvider();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-worker-retry-"));
    const worker = new MediaGenerationWorker(db, audit(db), workerConfig, { oviConfig, oviFetch: provider.fetchImpl, storageRoot, processOptions: { runner: processingRunner(storageRoot) } });
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('failed-job','media-1','ovi','FAILED',?,'now','now')")
      .run(JSON.stringify({ sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, outputAssetId: "old-asset" }));
    const retry = worker.retry("media-1", "failed-job", { jobId: "retry-job", now: "retry", approved: true });
    assert.equal(retry.status, "QUEUED");
    provider.complete();
    await waitFor(() => getGenerationJob(db, "media-1", "retry-job").status === "COMPLETED");
    assert.equal(listGenerationStatusHistory(db, "media-1", "failed-job").at(-1)?.status, "RETRIED");
  });

  it("recovers queued startup jobs and fails ambiguous in-flight jobs", async () => {
    const db = dbFixture();
    const provider = delayedProvider();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-worker-recovery-"));
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('queued-recovery','media-1','ovi','QUEUED',?,'now','now')")
      .run(JSON.stringify({ sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, outputAssetId: "asset-r" }));
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('processing-recovery','media-1','ovi','PROCESSING',?,'now','now')")
      .run(JSON.stringify({ sceneId: "scene-2", task: "T2V", providerKey: "ovi", approved: true, outputAssetId: "asset-p" }));
    const worker = new MediaGenerationWorker(db, audit(db), workerConfig, { oviConfig, oviFetch: provider.fetchImpl, storageRoot, processOptions: { runner: processingRunner(storageRoot) } });
    worker.recoverStartup("startup");
    assert.equal(getGenerationJob(db, "media-1", "processing-recovery").status, "FAILED");
    provider.complete();
    await waitFor(() => getGenerationJob(db, "media-1", "queued-recovery").status === "COMPLETED");
  });

  it("rejects unauthorized job access", () => {
    const db = dbFixture();
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('owned-job','media-1','ovi','QUEUED','{}','now','now')").run();
    assert.throws(() => getGenerationJob(db, "media-2", "owned-job"), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 404);
  });
});
