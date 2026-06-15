import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { listGenerationStatusHistory, recordGenerationStatusHistory } from "./media-generation-history.js";
import { cancelExternalGeneration, generateExternalMedia, retryExternalGeneration, type ExternalMediaConfig, type ExternalMediaHttp } from "./ovi-ltx-provider.js";
import type { ProcessRunner } from "./media-processing.js";

const config: ExternalMediaConfig = { enabled: true, baseUrl: "http://127.0.0.1:8391", apiKey: "secret-key", timeoutMs: 2_000 };

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
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-1','History','', '16:9','ACTIVE','now','now')").run();
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-2','Other','', '16:9','ACTIVE','now','now')").run();
  db.prepare("INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,approved_at,created_at,updated_at) VALUES ('scene-1','media-1','brief-1',1,'Opening','Desc',5,'Hello','Launch prompt','16:9','APPROVED','approved','now','now')").run();
  return db;
}

const audit = (db: Database.Database): MediaAuditWriter => (eventType, summary, values = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function progressFetch(): ExternalMediaHttp {
  let pollCount = 0;
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/jobs")) return jsonResponse({ job_id: "remote-1" });
    if (url.endsWith("/jobs/remote-1")) {
      pollCount += 1;
      if (pollCount === 1) return jsonResponse({ status: "running", progress: 25 });
      return jsonResponse({ status: "completed", progress: 100, output: { filename: "generated.mp4", url: "/jobs/remote-1/output" } });
    }
    if (url.endsWith("/jobs/remote-1/output")) return new Response(new Uint8Array(Buffer.from("video")), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

function failingFetch(): ExternalMediaHttp {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/jobs")) return jsonResponse({ job_id: "remote-1" });
    if (url.endsWith("/jobs/remote-1")) return jsonResponse({ status: "failed", error: "Bearer secret-token failed" });
    return jsonResponse({});
  };
}

function cancelFetch(): ExternalMediaHttp {
  return async (input) => String(input).endsWith("/cancel") ? jsonResponse({ cancelled: true }) : jsonResponse({});
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

describe("media generation status history", () => {
  it("records creation, provider progress, and success history", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-history-"));
    await generateExternalMedia(db, "media-1", "scene-1", {
      providerKey: "ovi",
      task: "T2V",
      jobId: "job-1",
      outputAssetId: "asset-1",
      now: "now",
      approved: true,
      config,
      fetchImpl: progressFetch(),
      storageRoot,
      processOptions: { runner: processingRunner(storageRoot) }
    }, audit(db));

    const history = listGenerationStatusHistory(db, "media-1", "job-1");
    assert.equal(history[0]?.status, "QUEUED");
    assert.equal(history.at(-1)?.status, "COMPLETED");
    assert.equal(history.some((entry) => entry.progressPercent === 25 && entry.providerStatus === "running"), true);
    assert.equal(history.some((entry) => entry.progressPercent === 100 && entry.providerStatus === "completed"), true);
    assert.equal(history.at(-1)?.message, "Generated generated.mp4");
  });

  it("records sanitized failure messages", async () => {
    const db = dbFixture();
    await assert.rejects(() => generateExternalMedia(db, "media-1", "scene-1", {
      providerKey: "ovi",
      task: "T2V",
      jobId: "job-failed",
      outputAssetId: "asset-failed",
      now: "now",
      approved: true,
      config,
      fetchImpl: failingFetch()
    }, audit(db)), /redacted/);

    const failed = listGenerationStatusHistory(db, "media-1", "job-failed").at(-1);
    assert.equal(failed?.status, "FAILED");
    assert.match(failed?.message ?? "", /redacted/);
    assert.equal((failed?.message ?? "").includes("secret-token"), false);
  });

  it("records cancellation and retry history", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-history-retry-"));
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at) VALUES ('old-job','media-1','ovi','RUNNING',?,?, 'now','now')")
      .run(JSON.stringify({ sceneId: "scene-1", task: "T2V" }), JSON.stringify({ result: { remoteJobId: "remote-1" } }));

    await cancelExternalGeneration(db, "media-1", "old-job", "ovi", "cancel", audit(db), config, cancelFetch());
    assert.equal(listGenerationStatusHistory(db, "media-1", "old-job").at(-1)?.status, "CANCELLED");

    await retryExternalGeneration(db, "media-1", "old-job", {
      jobId: "retry-job",
      outputAssetId: "retry-asset",
      now: "retry",
      approved: true,
      config,
      fetchImpl: progressFetch(),
      storageRoot,
      processOptions: { runner: processingRunner(storageRoot) }
    }, audit(db));
    assert.equal(listGenerationStatusHistory(db, "media-1", "old-job").at(-1)?.status, "RETRIED");
    assert.equal(listGenerationStatusHistory(db, "media-1", "retry-job")[0]?.status, "QUEUED");
  });

  it("suppresses duplicate consecutive status entries", () => {
    const db = dbFixture();
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('job-dupe','media-1','ovi','RUNNING','{}','now','now')").run();
    recordGenerationStatusHistory(db, { generationJobId: "job-dupe", status: "RUNNING", progressPercent: 50, message: "same", createdAt: "1" });
    recordGenerationStatusHistory(db, { generationJobId: "job-dupe", status: "RUNNING", progressPercent: 50, message: "same", createdAt: "2" });
    recordGenerationStatusHistory(db, { generationJobId: "job-dupe", status: "RUNNING", progressPercent: 60, message: "same", createdAt: "3" });
    assert.equal(listGenerationStatusHistory(db, "media-1", "job-dupe").length, 2);
  });

  it("rejects status history access outside the owning media project", () => {
    const db = dbFixture();
    db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('job-owned','media-1','ovi','RUNNING','{}','now','now')").run();
    assert.throws(() => listGenerationStatusHistory(db, "media-2", "job-owned"), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 404);
  });
});
