import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { type MediaAuditWriter, MediaStudioError } from "./media-studio.js";
import { cancelLongCatGeneration, generateLongCatPresenter, longCatStatusResponse, retryLongCatGeneration, testLongCatConnection, type LongCatConfig, type LongCatHttp } from "./longcat-provider.js";
import type { ProcessRunner } from "./media-processing.js";

const config: LongCatConfig = { enabled: true, baseUrl: "http://token:secret@127.0.0.1:8291", timeoutMs: 2_000 };

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_processing_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,status TEXT NOT NULL,operation TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,approved_at,created_at,updated_at) VALUES ('scene-1','media-1','brief-1',1,'Presenter','Desc',5,'Hello world','Talk to camera','16:9','APPROVED','approved','now','now')").run();
  return db;
}

async function seedPresenterInputs(db: Database.Database, storageRoot: string) {
  const sceneRoot = path.join(storageRoot, "media-1", "scene-1");
  await fs.mkdir(sceneRoot, { recursive: true });
  const imagePath = path.join(sceneRoot, "input.png");
  const audioPath = path.join(sceneRoot, "voice.wav");
  await fs.writeFile(imagePath, "image");
  await fs.writeFile(audioPath, "audio");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,created_at,updated_at)
    VALUES ('image-1','media-1','scene-1','image','Image','local-upload','UPLOADED','input.png','input.png','image/png',5,'abc',?,'now','now')`).run(imagePath);
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,created_at,updated_at)
    VALUES ('audio-1','media-1','scene-1','audio','Audio','local-upload','UPLOADED','voice.wav','voice.wav','audio/wav',5,'def',?,'now','now')`).run(audioPath);
}

const audit = (db: Database.Database): MediaAuditWriter => (eventType, summary, values = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mockLongCatFetch(calls: string[] = []): LongCatHttp {
  return async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/health")) return jsonResponse({ ok: true });
    if (url.endsWith("/jobs")) return jsonResponse({ job_id: "longcat-1" });
    if (url.endsWith("/jobs/longcat-1")) return jsonResponse({ status: "completed", output: { filename: "presenter.mp4", url: "/jobs/longcat-1/output" } });
    if (url.endsWith("/jobs/longcat-1/output")) return new Response(new Uint8Array(Buffer.from("video")), { status: 200 });
    if (url.endsWith("/jobs/longcat-1/cancel")) return jsonResponse({ cancelled: true });
    return new Response("not found", { status: 404 });
  };
}

function failingLongCatFetch(): LongCatHttp {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/jobs")) return jsonResponse({ job_id: "longcat-1" });
    if (url.endsWith("/jobs/longcat-1")) return jsonResponse({ status: "failed", error: "Bearer secret-token-123456789012345678901234 failed" });
    return jsonResponse({});
  };
}

function processingRunner(storageRoot: string): ProcessRunner {
  return async (_command, args) => {
    if (args.includes("-version")) return { stdout: "version", stderr: "", exitCode: 0 };
    if (args.includes("-show_streams")) {
      return {
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "24/1" }, { codec_type: "audio", codec_name: "aac" }],
          format: { duration: "5.0" }
        }),
        stderr: "",
        exitCode: 0
      };
    }
    const output = args[args.length - 1];
    if (typeof output === "string" && path.resolve(output).startsWith(path.resolve(storageRoot))) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, "derivative");
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("LongCat Avatar provider", () => {
  it("returns sanitized status and connection test results", async () => {
    assert.deepEqual(longCatStatusResponse(config), { enabled: true, baseUrlHostname: "127.0.0.1", timeoutMs: 2_000 });
    const result = await testLongCatConnection(config, mockLongCatFetch());
    assert.equal(result.status, "ok");
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });

  it("generates presenter output, saves it as a scene asset, and runs QC", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-longcat-"));
    const calls: string[] = [];
    try {
      await seedPresenterInputs(db, storageRoot);
      const result = await generateLongCatPresenter(db, "media-1", "scene-1", {
        jobId: "job-1",
        outputAssetId: "asset-1",
        now: "now",
        approved: true,
        config,
        fetchImpl: mockLongCatFetch(calls),
        storageRoot,
        processOptions: { runner: processingRunner(storageRoot) }
      }, audit(db));

      assert.equal(result.job.status, "COMPLETED");
      assert.equal((result.asset as { source: string }).source, "longcat-avatar");
      assert.equal((db.prepare("SELECT status FROM media_scenes WHERE id='scene-1'").get() as { status: string }).status, "ASSET_READY");
      assert.equal((db.prepare("SELECT status FROM media_processing_jobs WHERE asset_id='asset-1'").get() as { status: string }).status, "COMPLETED");
      assert.equal(calls.some((url) => url.endsWith("/jobs")), true);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_LONGCAT_GENERATION_COMPLETED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("marks the job failed and redacts provider error logs", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-longcat-"));
    try {
      await seedPresenterInputs(db, storageRoot);
      await assert.rejects(() => generateLongCatPresenter(db, "media-1", "scene-1", {
        jobId: "job-2",
        outputAssetId: "asset-2",
        now: "now",
        approved: true,
        config,
        fetchImpl: failingLongCatFetch(),
        storageRoot,
        processOptions: { runner: processingRunner(storageRoot) }
      }, audit(db)), /Bearer \[redacted\]/);

      const job = db.prepare("SELECT status,result_json AS resultJson FROM media_generation_jobs WHERE id='job-2'").get() as { status: string; resultJson: string };
      assert.equal(job.status, "FAILED");
      assert.equal(job.resultJson.includes("secret-token"), false);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_LONGCAT_GENERATION_FAILED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("cancels and retries LongCat generation jobs", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-longcat-"));
    const calls: string[] = [];
    try {
      await seedPresenterInputs(db, storageRoot);
      db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at) VALUES ('old-job','media-1','longcat-avatar','RUNNING',?,?, 'now','now')")
        .run(JSON.stringify({ sceneId: "scene-1", mode: "PRESENTER" }), JSON.stringify({ result: { remoteJobId: "longcat-1" } }));
      const cancelled = await cancelLongCatGeneration(db, "media-1", "old-job", "cancel", audit(db), config, mockLongCatFetch(calls));
      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(calls.some((url) => url.endsWith("/jobs/longcat-1/cancel")), true);

      const retried = await retryLongCatGeneration(db, "media-1", "old-job", {
        jobId: "retry-job",
        outputAssetId: "retry-asset",
        now: "retry",
        approved: true,
        config,
        fetchImpl: mockLongCatFetch(),
        storageRoot,
        processOptions: { runner: processingRunner(storageRoot) }
      }, audit(db));
      assert.equal(retried.job.status, "COMPLETED");
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("requires explicit approval before creating a generation job", async () => {
    const db = dbFixture();
    await assert.rejects(() => generateLongCatPresenter(db, "media-1", "scene-1", {
      jobId: "job-3",
      outputAssetId: "asset-3",
      now: "now",
      approved: false,
      config,
      fetchImpl: mockLongCatFetch()
    }, audit(db)), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 403);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs").get() as { count: number }).count, 0);
  });
});
