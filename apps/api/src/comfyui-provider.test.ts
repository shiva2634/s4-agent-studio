import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { activateComfyWorkflow, cancelComfyGeneration, comfyStatusResponse, generateWanForScene, importComfyWorkflow, previewCompiledWorkflow, retryComfyGeneration, testComfyConnection, updateComfyWorkflow, validateComfyWorkflow, type ComfyConfig, type ComfyHttp, type ComfyWorkflowMapping } from "./comfyui-provider.js";
import type { ProcessRunner } from "./media-processing.js";

const config: ComfyConfig = { enabled: true, baseUrl: "http://token:secret@127.0.0.1:8188", timeoutMs: 2_000 };

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'ACTIVE',archived_at TEXT,archived_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_chat_messages (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,sender TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE media_video_briefs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,logline TEXT NOT NULL,audience TEXT NOT NULL,style TEXT NOT NULL,duration_seconds INTEGER NOT NULL,constraints_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_comfy_workflows (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,workflow_type TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 0,is_builtin INTEGER NOT NULL DEFAULT 0,workflow_json TEXT NOT NULL,mapping_json TEXT NOT NULL,validation_json TEXT NOT NULL,deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_processing_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,status TEXT NOT NULL,operation TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  return db;
}

const mapping: ComfyWorkflowMapping = {
  prompt: "6.inputs.text",
  width: "5.inputs.width",
  height: "5.inputs.height",
  frames: "5.inputs.frames",
  fps: "5.inputs.fps",
  seed: "3.inputs.seed",
  image: "7.inputs.image",
  outputNodeId: "9"
};

function validWorkflow() {
  return {
    "3": { class_type: "KSampler", inputs: { seed: 1 } },
    "5": { class_type: "WanVideoSettings", inputs: { width: 1, height: 1, frames: 1, fps: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "7": { class_type: "LoadImage", inputs: { image: "" } },
    "9": { class_type: "SaveVideo", inputs: { filename_prefix: "wan" } }
  };
}

function seedActiveWorkflow(db: Database.Database, workflowType: "WAN_T2V" | "WAN_I2V" = "WAN_T2V") {
  importComfyWorkflow(db, "media-1", { id: `${workflowType}-workflow`, name: "Wan workflow", workflowType, workflowJson: validWorkflow(), mapping, activate: true, now: "workflow" }, audit(db));
}

const audit = (db: Database.Database): MediaAuditWriter => (eventType, summary, values = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function seedScene(db: Database.Database, status = "APPROVED") {
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-1','Wan','', '16:9','ACTIVE','now','now')").run();
  db.prepare("INSERT INTO media_video_briefs (id,media_project_id,title,logline,audience,style,duration_seconds,constraints_json,status,created_at,updated_at) VALUES ('brief-1','media-1','Brief','Logline','Audience','Style',5,'[]','APPROVED','now','now')").run();
  db.prepare("INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,approved_at,created_at,updated_at) VALUES ('scene-1','media-1','brief-1',1,'Opening','A bright opening',5,'Hello','Cinematic sunrise over product','16:9',?,'approved','now','now')").run(status);
}

async function seedImageAsset(db: Database.Database, storageRoot: string) {
  const imagePath = path.join(storageRoot, "media-1", "scene-1", "input.png");
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.writeFile(imagePath, "image");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,created_at,updated_at)
    VALUES ('image-1','media-1','scene-1','image','input.png','local-upload','UPLOADED','input.png','input.png','image/png',5,'abc',?,'now','now')`).run(imagePath);
}

function mockComfyFetch(calls: string[] = []): ComfyHttp {
  return async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/system_stats")) return jsonResponse({ system: "ok" });
    if (url.includes("/upload/image")) return jsonResponse({ name: "uploaded-input.png" });
    if (url.includes("/history/prompt-1")) return jsonResponse({ "prompt-1": { outputs: { "9": { videos: [{ filename: "wan-output.mp4", type: "output" }] } } } });
    if (url.includes("/prompt")) return jsonResponse({ prompt_id: "prompt-1" });
    if (url.includes("/view")) return new Response(new Uint8Array(Buffer.from("video")), { status: 200 });
    if (url.includes("/interrupt")) return jsonResponse({ ok: true });
    return new Response("not found", { status: 404 });
  };
}

function failingFetch(): ComfyHttp {
  return async (input) => {
    const url = String(input);
    if (url.includes("/prompt")) return new Response("bad", { status: 500 });
    return jsonResponse({});
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
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

describe("ComfyUI provider", () => {
  it("returns sanitized status and connection test results", async () => {
    assert.deepEqual(comfyStatusResponse(config), { enabled: true, baseUrlHostname: "127.0.0.1", timeoutMs: 2_000 });
    const result = await testComfyConnection(config, mockComfyFetch());
    assert.equal(result.status, "ok");
    assert.equal(result.baseUrlHostname, "127.0.0.1");
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });

  it("generates text-to-video output, saves it as a scene asset, and runs QC", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-comfy-"));
    const calls: string[] = [];
    try {
      seedScene(db);
      seedActiveWorkflow(db, "WAN_T2V");
      const result = await generateWanForScene(db, "media-1", "scene-1", {
        jobId: "job-1",
        outputAssetId: "asset-1",
        now: "now",
        mode: "text-to-video",
        approved: true,
        config,
        fetchImpl: mockComfyFetch(calls),
        storageRoot,
        processOptions: { runner: processingRunner(storageRoot) }
      }, audit(db));

      assert.equal(result.job.status, "COMPLETED");
      assert.equal((result.asset as { source: string }).source, "comfyui-wan");
      assert.equal((db.prepare("SELECT status FROM media_scenes WHERE id='scene-1'").get() as { status: string }).status, "ASSET_READY");
      assert.equal((db.prepare("SELECT status FROM media_processing_jobs WHERE asset_id='asset-1'").get() as { status: string }).status, "COMPLETED");
      assert.equal(calls.some((url) => url.includes("/upload/image")), false);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_WAN_GENERATION_COMPLETED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("uploads a scene image before image-to-video generation", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-comfy-"));
    const calls: string[] = [];
    try {
      seedScene(db);
      seedActiveWorkflow(db, "WAN_I2V");
      await seedImageAsset(db, storageRoot);
      await generateWanForScene(db, "media-1", "scene-1", {
        jobId: "job-2",
        outputAssetId: "asset-2",
        now: "now",
        mode: "image-to-video",
        approved: true,
        config,
        fetchImpl: mockComfyFetch(calls),
        storageRoot,
        processOptions: { runner: processingRunner(storageRoot) }
      }, audit(db));

      assert.equal(calls.some((url) => url.includes("/upload/image")), true);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("marks the job failed and audits sanitized ComfyUI failures", async () => {
    const db = dbFixture();
    seedScene(db);
    seedActiveWorkflow(db, "WAN_T2V");
    await assert.rejects(() => generateWanForScene(db, "media-1", "scene-1", {
      jobId: "job-3",
      outputAssetId: "asset-3",
      now: "now",
      mode: "text-to-video",
      approved: true,
      config,
      fetchImpl: failingFetch(),
      processOptions: { runner: processingRunner(".") }
    }, audit(db)), /ComfyUI workflow submit failed/);

    const job = db.prepare("SELECT status,result_json AS resultJson FROM media_generation_jobs WHERE id='job-3'").get() as { status: string; resultJson: string };
    assert.equal(job.status, "FAILED");
    assert.equal(job.resultJson.includes("secret"), false);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_WAN_GENERATION_FAILED'").get() as { count: number }).count, 1);
  });

  it("cancels and retries Wan generation jobs", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-comfy-"));
    try {
      seedScene(db);
      seedActiveWorkflow(db, "WAN_T2V");
      db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,created_at,updated_at) VALUES ('old-job','media-1','wan-2.2','FAILED',?,'now','now')")
        .run(JSON.stringify({ sceneId: "scene-1", mode: "text-to-video" }));
      const cancelled = await cancelComfyGeneration(db, "media-1", "old-job", "cancel", audit(db), config, mockComfyFetch());
      assert.equal(cancelled.status, "CANCELLED");

      const retried = await retryComfyGeneration(db, "media-1", "old-job", {
        jobId: "retry-job",
        outputAssetId: "retry-asset",
        now: "retry",
        approved: true,
        config,
        fetchImpl: mockComfyFetch(),
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
    seedScene(db);
    await assert.rejects(() => generateWanForScene(db, "media-1", "scene-1", {
      jobId: "job-4",
      outputAssetId: "asset-4",
      now: "now",
      mode: "text-to-video",
      approved: false,
      config,
      fetchImpl: mockComfyFetch()
    }, audit(db)), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 403);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs").get() as { count: number }).count, 0);
  });

  it("imports, validates, maps, versions, and activates workflows", () => {
    const db = dbFixture();
    seedScene(db);
    const imported = importComfyWorkflow(db, "media-1", { id: "workflow-1", name: "Wan", workflowType: "WAN_T2V", workflowJson: validWorkflow(), mapping, activate: true, now: "now" }, audit(db));
    assert.equal(imported.status, "VALID");
    assert.equal(imported.version, 1);
    assert.equal(imported.isActive, 1);

    const preview = previewCompiledWorkflow(db, "media-1", { workflowId: "workflow-1", sceneId: "scene-1", fps: 12, seed: 42 });
    const compiled = preview.compiledWorkflow as Record<string, { inputs: Record<string, unknown> }>;
    assert.equal(compiled["6"].inputs.text, "Cinematic sunrise over product");
    assert.equal(compiled["5"].inputs.width, 1920);
    assert.equal(compiled["5"].inputs.frames, 60);
    assert.equal(compiled["5"].inputs.fps, 12);
    assert.equal(compiled["3"].inputs.seed, 42);

    const updated = updateComfyWorkflow(db, "media-1", "workflow-1", { id: "workflow-2", name: "Wan", workflowJson: validWorkflow(), mapping, activate: true, now: "later" }, audit(db));
    assert.equal(updated.version, 2);
    assert.equal(updated.isActive, 1);
    assert.equal((db.prepare("SELECT is_active AS isActive FROM media_comfy_workflows WHERE id='workflow-1'").get() as { isActive: number }).isActive, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_COMFY_WORKFLOW_VERSIONED'").get() as { count: number }).count, 1);
  });

  it("records invalid workflow validation issues and blocks invalid activation", () => {
    const db = dbFixture();
    seedScene(db);
    const invalidMapping = { ...mapping, prompt: "missing.inputs.text" };
    const validation = validateComfyWorkflow("WAN_T2V", validWorkflow(), invalidMapping);
    assert.equal(validation.valid, false);
    assert.equal(validation.issues.some((issue) => issue.code === "MISSING_MAPPING_TARGET"), true);

    const imported = importComfyWorkflow(db, "media-1", { id: "workflow-bad", name: "Bad", workflowType: "WAN_T2V", workflowJson: validWorkflow(), mapping: invalidMapping, now: "now" }, audit(db));
    assert.equal(imported.status, "INVALID");
    assert.throws(() => activateComfyWorkflow(db, "media-1", "workflow-bad", "now", audit(db)), /Only valid ComfyUI workflows/);
  });

  it("blocks generation when no valid active workflow exists", async () => {
    const db = dbFixture();
    seedScene(db);
    await assert.rejects(() => generateWanForScene(db, "media-1", "scene-1", {
      jobId: "blocked-job",
      outputAssetId: "blocked-asset",
      now: "now",
      mode: "text-to-video",
      approved: true,
      config,
      fetchImpl: mockComfyFetch()
    }, audit(db)), /No valid active WAN_T2V ComfyUI workflow/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs").get() as { count: number }).count, 0);
  });
});
