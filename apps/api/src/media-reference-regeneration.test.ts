import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MediaGenerationWorker } from "./media-generation-worker.js";
import { getFlowPackage, routeMediaGeneration, type ProviderCapability } from "./media-provider-router.js";
import { approveGeneratedMediaAsset, ensurePromptVersionForScene, getMediaAssetApproval, listPromptVersions, resetGeneratedAssetApproval, validateGenerationReferences } from "./media-studio.js";
import { generateExternalMedia, type ExternalMediaConfig, type ExternalMediaHttp } from "./ovi-ltx-provider.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',archived_at TEXT,archived_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'APPROVED',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'READY',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PASSED',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,approval_status TEXT,approval_feedback TEXT,approved_at TEXT,approved_by TEXT,rejected_at TEXT,rejected_by TEXT,scene_version_id TEXT,prompt_version_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,scene_version_id TEXT,prompt_version_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_status_history (id TEXT PRIMARY KEY,generation_job_id TEXT NOT NULL,status TEXT NOT NULL,progress_percent INTEGER,message TEXT,provider_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE media_scene_versions (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT NOT NULL,version_number INTEGER NOT NULL,title TEXT NOT NULL,script_text TEXT NOT NULL DEFAULT '',visual_description TEXT NOT NULL DEFAULT '',duration_seconds INTEGER NOT NULL,position INTEGER NOT NULL,ordering_json TEXT NOT NULL DEFAULT '{}',content_hash TEXT NOT NULL,change_summary TEXT,created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(scene_id,version_number));
    CREATE TABLE media_generation_prompt_versions (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT NOT NULL,scene_version_id TEXT NOT NULL,version_number INTEGER NOT NULL,provider_key TEXT NOT NULL,task_type TEXT NOT NULL,positive_prompt TEXT NOT NULL,negative_prompt TEXT NOT NULL DEFAULT '',settings_json TEXT NOT NULL DEFAULT '{}',reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',content_hash TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(scene_id,provider_key,task_type,version_number));
    CREATE TABLE media_processing_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,status TEXT NOT NULL,operation TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-1','Project','','16:9','now','now')").run();
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-2','Other','','16:9','now','now')").run();
  db.prepare(`INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,created_at,updated_at)
    VALUES ('scene-1','media-1','brief-1',1,'Opening','Desc',4,'Line','Prompt','16:9','APPROVED','now','now')`).run();
  return db;
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "audit");
};

async function addAsset(db: Database.Database, id: string, projectId: string, sceneId: string | null, kind: string, mimeType: string, localPath: string, source = "user-import", qcStatus = "PASSED") {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, Buffer.from(`${id}-bytes`));
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,local_path,qc_status,qc_issues_json,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, sceneId, kind, id, source, "READY", `${id}.bin`, `${id}.bin`, mimeType, 10, localPath, qcStatus, "[]", "{}", "now", "now");
}

function capabilities(overrides: Partial<Record<string, Partial<ProviderCapability>>> = {}): ProviderCapability[] {
  const base: ProviderCapability[] = [
    { key: "google-flow", name: "Flow", supports: ["T2V", "I2V", "PRESENTER"], enabled: true, healthy: true, priority: 5, paid: false, mode: "HUMAN_ASSISTED", referenceTypes: ["image", "video", "audio"], reason: "flow" },
    { key: "wan-2.2", name: "Wan", supports: ["T2V", "I2V"], enabled: true, healthy: true, priority: 10, paid: false, mode: "COMFYUI", referenceTypes: ["image"], reason: "wan" },
    { key: "ovi", name: "Ovi", supports: ["T2V", "AUDIO_VIDEO"], enabled: true, healthy: true, priority: 20, paid: false, mode: "HTTP", referenceTypes: ["image", "video", "audio"], reason: "ovi" },
    { key: "ltx", name: "LTX", supports: ["T2V", "I2V"], enabled: true, healthy: true, priority: 30, paid: false, mode: "HTTP", referenceTypes: ["image", "video"], reason: "ltx" }
  ];
  return base.map((item) => ({ ...item, ...(overrides[item.key] ?? {}) }));
}

describe("media reference regeneration", () => {
  it("validates same-project references and rejects cross-project, missing, failed, and incompatible assets", async () => {
    const db = dbFixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ref-"));
    try {
      await addAsset(db, "image-1", "media-1", "scene-1", "image", "image/png", path.join(root, "image.png"));
      await addAsset(db, "audio-1", "media-1", "scene-1", "audio", "audio/wav", path.join(root, "audio.wav"));
      await addAsset(db, "other-1", "media-2", null, "image", "image/png", path.join(root, "other.png"));
      await addAsset(db, "bad-1", "media-1", "scene-1", "image", "image/png", path.join(root, "bad.png"), "user-import", "FAILED");
      db.prepare("INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,mime_type,local_path,qc_status,qc_issues_json,created_at,updated_at) VALUES ('missing-1','media-1','scene-1','image','Missing','user','READY','image/png',?,'PASSED','[]','now','now')").run(path.join(root, "missing.png"));

      assert.equal(validateGenerationReferences(db, "media-1", "I2V", ["image-1"], "wan-2.2").length, 1);
      assert.throws(() => validateGenerationReferences(db, "media-1", "I2V", ["other-1"], "wan-2.2"), /not found/);
      assert.throws(() => validateGenerationReferences(db, "media-1", "I2V", ["missing-1"], "wan-2.2"), /missing/);
      assert.throws(() => validateGenerationReferences(db, "media-1", "I2V", ["bad-1"], "wan-2.2"), /failed QC/);
      assert.throws(() => validateGenerationReferences(db, "media-1", "I2V", ["audio-1"], "wan-2.2"), /does not support/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("routes only to reference-capable providers and preserves references in prompt versions", async () => {
    const db = dbFixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ref-"));
    try {
      await addAsset(db, "image-1", "media-1", "scene-1", "image", "image/png", path.join(root, "image.png"));
      let adapterReferenceIds: string[] = [];
      await routeMediaGeneration(db, "media-1", "scene-1", {
        jobId: "job-1",
        outputAssetId: "asset-out",
        now: "route",
        task: "I2V",
        approved: true,
        referenceAssetIds: ["image-1"],
        capabilities: capabilities({ "google-flow": { enabled: false }, "wan-2.2": { priority: 1 } }),
        adapters: { "wan-2.2": async (input) => { adapterReferenceIds = input.referenceAssetIds ?? []; return { ok: true }; } }
      }, audit(db));
      const prompt = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "wan-2.2", taskType: "I2V", referenceAssetIds: ["image-1"], now: "prompt" });
      assert.deepEqual(adapterReferenceIds, ["image-1"]);
      assert.deepEqual(JSON.parse(prompt.referenceAssetIdsJson), ["image-1"]);
      await assert.rejects(() => routeMediaGeneration(db, "media-1", "scene-1", { jobId: "bad", outputAssetId: "bad-out", now: "route", task: "I2V", providerKey: "longcat-avatar", approved: true, referenceAssetIds: ["image-1"], capabilities: capabilities() }, audit(db)), /does not support/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("sends Ovi references as multipart media payloads", async () => {
    const db = dbFixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ref-"));
    try {
      await addAsset(db, "image-1", "media-1", "scene-1", "image", "image/png", path.join(root, "image.png"));
      let sawFormData = false;
      const fetchImpl: ExternalMediaHttp = async (url, init) => {
        const pathName = String(url);
        if (pathName.endsWith("/jobs") && init?.method === "POST") {
          sawFormData = init.body instanceof FormData;
          return new Response(JSON.stringify({ job_id: "remote-1" }), { status: 200 });
        }
        if (pathName.endsWith("/jobs/remote-1")) return new Response(JSON.stringify({ status: "completed", output: { filename: "out.mp4" } }), { status: 200 });
        if (pathName.endsWith("/jobs/remote-1/output")) return new Response(Buffer.from("mp4"), { status: 200 });
        return new Response("not found", { status: 404 });
      };
      await generateExternalMedia(db, "media-1", "scene-1", { providerKey: "ovi", task: "T2V", jobId: "ovi-job", outputAssetId: "ovi-asset", now: "gen", approved: true, referenceAssetIds: ["image-1"], config: { enabled: true, baseUrl: "http://ovi.local", apiKey: "", timeoutMs: 1_000 }, fetchImpl, storageRoot: root, processOptions: { runner: async () => ({ stdout: "", stderr: "", exitCode: 1 }) } }, audit(db));
      assert.equal(sawFormData, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates regeneration jobs without overwriting the source asset approval", async () => {
    const db = dbFixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ref-"));
    try {
      await addAsset(db, "gen-1", "media-1", "scene-1", "video", "video/mp4", path.join(root, "gen.mp4"), "ovi");
      resetGeneratedAssetApproval(db, "gen-1", "pending");
      approveGeneratedMediaAsset(db, "media-1", "gen-1", { now: "approved" }, audit(db));
      const worker = new MediaGenerationWorker(db, audit(db), { concurrency: 1, pollingIntervalMs: 1, maxProcessingMs: 50 }, { oviConfig: { enabled: false, baseUrl: "http://ovi.local", apiKey: "", timeoutMs: 10 } });
      const job = worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, referenceAssetIds: ["gen-1"], regenerationReason: " change background ", jobId: "regen-job", outputAssetId: "regen-asset", now: "regen" });
      const request = JSON.parse(job.requestJson) as { referenceAssetIds: string[]; regenerationReason: string; promptVersionId: string };
      const prompt = listPromptVersions(db, "media-1", "scene-1")[0] as { referenceAssetIdsJson: string };
      assert.deepEqual(request.referenceAssetIds, ["gen-1"]);
      assert.equal(request.regenerationReason, "change background");
      assert.deepEqual(JSON.parse(prompt.referenceAssetIdsJson), ["gen-1"]);
      assert.equal(getMediaAssetApproval(db, "media-1", "gen-1").approvalStatus, "APPROVED");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE id='regen-asset'").get() as { count: number }).count, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("Flow packages include selected references without local paths", async () => {
    const db = dbFixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-ref-"));
    try {
      await addAsset(db, "image-1", "media-1", "scene-1", "image", "image/png", path.join(root, "image.png"));
      await routeMediaGeneration(db, "media-1", "scene-1", { jobId: "flow-job", outputAssetId: "flow-asset", now: "flow", task: "T2V", approved: true, referenceAssetIds: ["image-1"], regenerationReason: "preserve character", capabilities: capabilities({ "google-flow": { priority: 1 } }) }, audit(db));
      const pkg = getFlowPackage(db, "media-1", "flow-job") as { references: Array<{ id: string; localPath: string | null; importInstruction?: string }>; regenerationReason?: string | null };
      assert.equal(pkg.references[0]?.id, "image-1");
      assert.equal(pkg.references[0]?.localPath, null);
      assert.match(pkg.references[0]?.importInstruction ?? "", /registered project asset/);
      assert.equal(pkg.regenerationReason, "preserve character");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
