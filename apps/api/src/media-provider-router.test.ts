import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { fallbackFlowJobToWan, getFlowPackage, getMediaProviderCapabilities, importFlowGeneratedAsset, retryFlowJob, routeMediaGeneration, selectMediaProviders, type ProviderCapability } from "./media-provider-router.js";
import type { ProcessRunner } from "./media-processing.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_brand_kits (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,colors_json TEXT NOT NULL DEFAULT '[]',fonts_json TEXT NOT NULL DEFAULT '[]',tagline TEXT NOT NULL DEFAULT '',tone TEXT NOT NULL DEFAULT '',disclaimer TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_presenter_profiles (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,appearance_prompt TEXT NOT NULL DEFAULT '',voice_accent TEXT NOT NULL DEFAULT '',clothing TEXT NOT NULL DEFAULT '',consistency_rules TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_comfy_workflows (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,workflow_type TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 0,is_builtin INTEGER NOT NULL DEFAULT 0,workflow_json TEXT NOT NULL,mapping_json TEXT NOT NULL,validation_json TEXT NOT NULL,deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_processing_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,status TEXT NOT NULL,operation TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES ('media-1','Router','', '16:9','ACTIVE','now','now')").run();
  db.prepare("INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,created_at,updated_at) VALUES ('scene-1','media-1','brief-1',1,'Opening','Desc',5,'Hello','A cinematic product reveal','16:9','APPROVED','now','now')").run();
  db.prepare("INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,created_at,updated_at) VALUES ('ref-1','media-1','scene-1','reference','Reference','chat-derived','PLANNED','ref.png','ref.png','image/png',123,'now','now')").run();
  return db;
}

const audit = (db: Database.Database): MediaAuditWriter => (eventType, summary, values = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function capabilities(overrides: Partial<Record<string, Partial<ProviderCapability>>> = {}): ProviderCapability[] {
  return getMediaProviderCapabilities(
    { enabled: true, baseUrl: "http://127.0.0.1:8188", timeoutMs: 1_000 },
    { enabled: false, baseUrl: "http://127.0.0.1:8291", timeoutMs: 1_000 },
    { enabled: false, baseUrl: "http://127.0.0.1:8391", apiKey: "", timeoutMs: 1_000 },
    { enabled: false, baseUrl: "http://127.0.0.1:8491", apiKey: "", timeoutMs: 1_000 }
  ).map((provider) => ({
    ...provider,
    ...(overrides[provider.key] ?? {})
  }));
}

describe("media provider router", () => {
  it("selects providers by capability, health, enabled state, and priority", () => {
    const selected = selectMediaProviders("T2V", capabilities());
    assert.equal(selected.selected?.key, "google-flow");
    assert.match(selected.reason, /Flow/);

    const fallback = selectMediaProviders("T2V", capabilities({ "google-flow": { enabled: false, healthy: false } }));
    assert.equal(fallback.selected?.key, "wan-2.2");
    assert.equal(fallback.skipped.some((item) => item.key === "google-flow" && item.reason === "Provider is disabled"), true);

    const presenter = selectMediaProviders("PRESENTER", capabilities({ "longcat-avatar": { enabled: true, healthy: true } }));
    assert.equal(presenter.selected?.key, "longcat-avatar");

    const audioVideo = selectMediaProviders("AUDIO_VIDEO", capabilities({ "ovi": { enabled: true, healthy: true } }));
    assert.equal(audioVideo.selected?.key, "ovi");
  });

  it("routes Wan attempts through the selected adapter and persists routing reason", async () => {
    const db = dbFixture();
    const result = await routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "job-1",
      outputAssetId: "asset-1",
      now: "now",
      task: "T2V",
      approved: true,
      capabilities: capabilities({ "google-flow": { enabled: false, healthy: false } }),
      adapters: {
        "wan-2.2": async ({ db, projectId, jobId, now }) => {
          db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
            .run(jobId, projectId, "wan-2.2", "COMPLETED", "{}", "{}", now, now);
          return { job: { id: jobId, status: "COMPLETED" } };
        }
      }
    }, audit(db));

    assert.equal(result.routing.selectedProvider, "wan-2.2");
    const job = db.prepare("SELECT result_json AS resultJson FROM media_generation_jobs WHERE id='job-1'").get() as { resultJson: string };
    assert.equal(JSON.parse(job.resultJson).routing.selectedProvider, "wan-2.2");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROVIDER_ROUTE_SELECTED'").get() as { count: number }).count, 1);
  });

  it("falls back after a failed provider attempt", async () => {
    const db = dbFixture();
    const result = await routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "job-2",
      outputAssetId: "asset-2",
      now: "now",
      task: "T2V",
      approved: true,
      paidProviderApproved: true,
      maxAttempts: 2,
      capabilities: capabilities({ "google-flow": { enabled: false, healthy: false }, "wan-2.2": { priority: 10 }, "ovi": { enabled: true, healthy: true, priority: 20, mode: "HUMAN_ASSISTED" } }),
      adapters: {
        "wan-2.2": async () => {
          throw new MediaStudioError("Wan failed", 502);
        }
      }
    }, audit(db));

    assert.equal(result.routing.selectedProvider, "ovi");
    assert.equal(result.routing.attempted.some((attempt) => attempt.providerKey === "wan-2.2" && attempt.status === "FAILED"), true);
    assert.equal((db.prepare("SELECT status FROM media_generation_jobs WHERE id='job-2'").get() as { status: string }).status, "WAITING_FOR_USER");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROVIDER_ROUTE_FALLBACK'").get() as { count: number }).count, 1);
  });

  it("blocks paid providers without explicit paid-provider approval", async () => {
    const db = dbFixture();
    await assert.rejects(() => routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "job-3",
      outputAssetId: "asset-3",
      now: "now",
      task: "T2V",
      approved: true,
      capabilities: capabilities({ "wan-2.2": { enabled: false, healthy: false } })
    }, audit(db)), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 403);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROVIDER_ROUTE_PAID_APPROVAL_REQUIRED'").get() as { count: number }).count, 1);
  });

  it("routes AUDIO_VIDEO through Ovi when enabled", async () => {
    const db = dbFixture();
    const result = await routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "ovi-route",
      outputAssetId: "ovi-asset",
      now: "now",
      task: "AUDIO_VIDEO",
      approved: true,
      capabilities: capabilities({ "ovi": { enabled: true, healthy: true } }),
      adapters: {
        "ovi": async ({ db, projectId, jobId, now }) => {
          db.prepare("INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
            .run(jobId, projectId, "ovi", "COMPLETED", "{}", "{}", now, now);
          return { job: { id: jobId, status: "COMPLETED" } };
        }
      }
    }, audit(db));

    assert.equal(result.routing.selectedProvider, "ovi");
    assert.equal((db.prepare("SELECT provider_key AS providerKey,status FROM media_generation_jobs WHERE id='ovi-route'").get() as { providerKey: string; status: string }).providerKey, "ovi");
  });

  it("requires paid-provider approval before LTX fallback can run", async () => {
    const db = dbFixture();
    await assert.rejects(() => routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "ltx-paid",
      outputAssetId: "ltx-asset",
      now: "now",
      task: "I2V",
      approved: true,
      maxAttempts: 3,
      capabilities: capabilities({ "google-flow": { enabled: false, healthy: false }, "wan-2.2": { enabled: false, healthy: false }, "ltx": { enabled: true, healthy: true } })
    }, audit(db)), (error: unknown) => error instanceof MediaStudioError && error.statusCode === 403 && /LTX/.test(error.message));
  });

  it("audits exhaustion when disabled or unhealthy providers cannot complete", async () => {
    const db = dbFixture();
    await assert.rejects(() => routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "job-4",
      outputAssetId: "asset-4",
      now: "now",
      task: "PRESENTER",
      approved: true,
      paidProviderApproved: true,
      capabilities: capabilities({ "google-flow": { enabled: false, healthy: false }, "longcat-avatar": { enabled: false, healthy: false } })
    }, audit(db)), /No provider completed PRESENTER/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROVIDER_ROUTE_EXHAUSTED'").get() as { count: number }).count, 1);
  });

  it("routes PRESENTER through LongCat and falls back to Flow when LongCat fails", async () => {
    const db = dbFixture();
    const result = await routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "presenter-1",
      outputAssetId: "asset-1",
      now: "now",
      task: "PRESENTER",
      approved: true,
      paidProviderApproved: true,
      capabilities: capabilities({ "longcat-avatar": { enabled: true, healthy: true } }),
      adapters: {
        "longcat-avatar": async () => {
          throw new MediaStudioError("LongCat failed", 502);
        }
      }
    }, audit(db));

    assert.equal(result.routing.selectedProvider, "google-flow");
    assert.equal(result.routing.attempted.some((attempt) => attempt.providerKey === "longcat-avatar" && attempt.status === "FAILED"), true);
    assert.equal((db.prepare("SELECT provider_key AS providerKey,status FROM media_generation_jobs WHERE id='presenter-1'").get() as { providerKey: string; status: string }).providerKey, "google-flow");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROVIDER_ROUTE_FALLBACK'").get() as { count: number }).count, 1);
  });

  it("routes eligible T2V jobs to Flow and creates a package", async () => {
    const db = dbFixture();
    const result = await routeMediaGeneration(db, "media-1", "scene-1", {
      jobId: "flow-1",
      outputAssetId: "unused",
      now: "now",
      task: "T2V",
      approved: true,
      paidProviderApproved: true,
      capabilities: capabilities()
    }, audit(db));
    assert.equal(result.routing.selectedProvider, "google-flow");
    const flowPackage = getFlowPackage(db, "media-1", "flow-1");
    assert.equal(flowPackage.scene.prompt, "A cinematic product reveal");
    assert.equal(flowPackage.scene.dialogue, "Hello");
    assert.equal(flowPackage.references.length, 1);
    assert.match(flowPackage.prompt, /Aspect ratio: 16:9/);
  });

  it("imports Flow generated files, runs QC, and marks the scene asset ready", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-flow-"));
    try {
      await routeMediaGeneration(db, "media-1", "scene-1", { jobId: "flow-2", outputAssetId: "unused", now: "now", task: "T2V", approved: true, paidProviderApproved: true, capabilities: capabilities() }, audit(db));
      const runner: ProcessRunner = async (_command, args) => {
        if (args.includes("-version")) return { stdout: "version", stderr: "", exitCode: 0 };
        if (args.includes("-show_streams")) return { stdout: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "24/1" }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "5" } }), stderr: "", exitCode: 0 };
        const output = args[args.length - 1];
        if (typeof output === "string") {
          await fs.mkdir(path.dirname(output), { recursive: true });
          await fs.writeFile(output, "derivative");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };
      const result = await importFlowGeneratedAsset(db, "media-1", "flow-2", { assetId: "flow-asset", processingJobId: "flow-qc", originalName: "flow.mp4", mimeType: "video/mp4", bytes: Buffer.from("video"), now: "import", storageRoot, processOptions: { runner } }, audit(db));
      assert.equal((result.job as { status: string }).status, "IMPORTED");
      assert.equal((result.asset as { source: string }).source, "google-flow");
      assert.equal((db.prepare("SELECT status FROM media_scenes WHERE id='scene-1'").get() as { status: string }).status, "ASSET_READY");
      assert.equal((db.prepare("SELECT status FROM media_processing_jobs WHERE id='flow-qc'").get() as { status: string }).status, "COMPLETED");
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("retries Flow jobs and can fallback to Wan", async () => {
    const db = dbFixture();
    await routeMediaGeneration(db, "media-1", "scene-1", { jobId: "flow-3", outputAssetId: "unused", now: "now", task: "T2V", approved: true, paidProviderApproved: true, capabilities: capabilities() }, audit(db));
    const retry = retryFlowJob(db, "media-1", "flow-3", { jobId: "flow-3-retry", now: "retry" }, audit(db)) as { status: string };
    assert.equal(retry.status, "WAITING_FOR_USER");
    const fallback = await fallbackFlowJobToWan(db, "media-1", "flow-3", { jobId: "wan-fallback", outputAssetId: "wan-asset", now: "fallback", approved: true, config: { enabled: true, baseUrl: "http://127.0.0.1:8188", timeoutMs: 1_000 }, fetchImpl: async () => new Response("{}", { status: 500 }) }, audit(db)).catch((error: unknown) => error);
    assert.match(fallback instanceof Error ? fallback.message : "", /No valid active WAN_T2V|ComfyUI workflow|failed/i);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_FLOW_JOB_FALLBACK_TO_WAN'").get() as { count: number }).count, 1);
  });
});
