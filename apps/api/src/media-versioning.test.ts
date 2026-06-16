import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { MediaGenerationWorker } from "./media-generation-worker.js";
import {
  approveMediaScene,
  ensurePromptVersionForScene,
  getPromptVersion,
  getSceneVersion,
  listPromptVersions,
  listSceneVersions,
  restoreSceneVersion,
  updateMediaScene
} from "./media-studio.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',archived_at TEXT,archived_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,approval_status TEXT,approval_feedback TEXT,approved_at TEXT,approved_by TEXT,rejected_at TEXT,rejected_by TEXT,scene_version_id TEXT,prompt_version_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,scene_version_id TEXT,prompt_version_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_generation_status_history (id TEXT PRIMARY KEY,generation_job_id TEXT NOT NULL,status TEXT NOT NULL,progress_percent INTEGER,message TEXT,provider_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE media_scene_versions (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT NOT NULL,version_number INTEGER NOT NULL,title TEXT NOT NULL,script_text TEXT NOT NULL DEFAULT '',visual_description TEXT NOT NULL DEFAULT '',duration_seconds INTEGER NOT NULL,position INTEGER NOT NULL,ordering_json TEXT NOT NULL DEFAULT '{}',content_hash TEXT NOT NULL,change_summary TEXT,created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(scene_id,version_number));
    CREATE TABLE media_generation_prompt_versions (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT NOT NULL,scene_version_id TEXT NOT NULL,version_number INTEGER NOT NULL,provider_key TEXT NOT NULL,task_type TEXT NOT NULL,positive_prompt TEXT NOT NULL,negative_prompt TEXT NOT NULL DEFAULT '',settings_json TEXT NOT NULL DEFAULT '{}',reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',content_hash TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(scene_id,provider_key,task_type,version_number));
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-1','Project','','16:9','now','now')").run();
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-2','Other','','16:9','now','now')").run();
  db.prepare(`INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,created_at,updated_at)
    VALUES ('scene-1','media-1','brief-1',1,'Opening','Wide shot',4,'Line one','Wide cinematic prompt','16:9','DRAFT','now','now')`).run();
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,created_at,updated_at) VALUES ('ref-1','media-1','scene-1','reference','Ref','manual','READY','now','now')`).run();
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,created_at,updated_at) VALUES ('ref-other','media-2',NULL,'reference','Other','manual','READY','now','now')`).run();
  return db;
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "audit");
};

describe("media scene and prompt versioning", () => {
  it("creates an initial scene version and suppresses unchanged duplicates", () => {
    const db = dbFixture();
    const first = listSceneVersions(db, "media-1", "scene-1");
    const second = listSceneVersions(db, "media-1", "scene-1");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0]?.versionNumber, 1);
  });

  it("creates a new scene version after content edits and leaves history immutable", () => {
    const db = dbFixture();
    const original = listSceneVersions(db, "media-1", "scene-1")[0] as { id: string; title: string };
    approveMediaScene(db, "media-1", "scene-1", "approved", audit(db));
    const updated = updateMediaScene(db, "media-1", "scene-1", { title: "Updated", durationSeconds: 5, dialogue: "New line", visualPrompt: "New prompt", aspectRatio: "16:9", status: "APPROVED", now: "edit" }, audit(db));
    const versions = listSceneVersions(db, "media-1", "scene-1");
    const historical = getSceneVersion(db, "media-1", "scene-1", original.id);
    assert.equal(updated.status, "DRAFT");
    assert.equal(versions.length, 2);
    assert.equal(historical.title, original.title);
  });

  it("creates prompt versions on prompt changes and suppresses unchanged duplicates", () => {
    const db = dbFixture();
    const first = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "Prompt A", now: "p1" });
    const duplicate = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "Prompt A", now: "p2" });
    const second = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "Prompt B", now: "p3" });
    assert.equal(first.id, duplicate.id);
    assert.equal(second.versionNumber, 2);
    assert.equal(listPromptVersions(db, "media-1", "scene-1").length, 2);
  });

  it("links queued generation jobs to the exact prompt version", () => {
    const db = dbFixture();
    const prompt = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "Prompt A", now: "p1" });
    const worker = new MediaGenerationWorker(db, audit(db), { concurrency: 1, pollingIntervalMs: 1, maxProcessingMs: 100 }, { oviConfig: { enabled: false, baseUrl: "http://localhost", apiKey: "", timeoutMs: 10 } });
    const job = worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: "T2V", providerKey: "ovi", approved: true, promptVersionId: prompt.id, now: "queued", jobId: "job-1", outputAssetId: "asset-out" });
    const row = db.prepare("SELECT prompt_version_id AS promptVersionId,scene_version_id AS sceneVersionId FROM media_generation_jobs WHERE id='job-1'").get() as { promptVersionId: string; sceneVersionId: string };
    assert.equal(job.status, "QUEUED");
    assert.equal(row.promptVersionId, prompt.id);
    assert.equal(row.sceneVersionId, prompt.sceneVersionId);
  });

  it("restores an old scene by creating a new current version", () => {
    const db = dbFixture();
    const original = listSceneVersions(db, "media-1", "scene-1")[0] as { id: string };
    updateMediaScene(db, "media-1", "scene-1", { title: "Changed", durationSeconds: 6, dialogue: "Changed", visualPrompt: "Changed", aspectRatio: "16:9", status: "DRAFT", now: "edit" }, audit(db));
    const restored = restoreSceneVersion(db, "media-1", "scene-1", original.id, { now: "restore", changeSummary: "restore" }, audit(db));
    const versions = listSceneVersions(db, "media-1", "scene-1");
    assert.equal(restored.title, "Opening");
    assert.equal(versions[0]?.versionNumber, 3);
  });

  it("rejects cross-project reference assets and unauthorized version access", () => {
    const db = dbFixture();
    assert.throws(() => ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "x", referenceAssetIds: ["ref-other"], now: "p1" }), /same media project/);
    const version = listSceneVersions(db, "media-1", "scene-1")[0] as { id: string };
    assert.throws(() => getSceneVersion(db, "media-2", "scene-1", version.id), /Media scene not found/);
  });

  it("reuses an old prompt version by creating a new queued generation job", () => {
    const db = dbFixture();
    const prompt = ensurePromptVersionForScene(db, "media-1", "scene-1", { providerKey: "ovi", taskType: "T2V", positivePrompt: "Prompt A", now: "p1" });
    const loaded = getPromptVersion(db, "media-1", "scene-1", prompt.id);
    const worker = new MediaGenerationWorker(db, audit(db), { concurrency: 1, pollingIntervalMs: 1, maxProcessingMs: 100 }, { oviConfig: { enabled: false, baseUrl: "http://localhost", apiKey: "", timeoutMs: 10 } });
    const job = worker.enqueueGeneration({ projectId: "media-1", sceneId: "scene-1", task: loaded.taskType as "T2V", providerKey: loaded.providerKey as "ovi", approved: true, promptVersionId: loaded.id, now: "reuse", jobId: "reuse-job" });
    assert.equal(job.status, "QUEUED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs").get() as { count: number }).count, 1);
  });
});
