import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { addDirectorChatMessage, approveMediaScene, createBrandKit, createMediaProject, reorderMediaScenes, selectMediaLibraryDefaults, selectProjectBackgroundMusic, updateAudioAssetSettings, updateMediaScene, uploadLibraryAsset, uploadProjectAsset, uploadSceneAsset } from "./media-studio.js";
import { cancelRenderJob, renderDraftVideo, validateRenderReadiness, type RenderDraftOptions } from "./media-rendering.js";
import type { ProcessRunner } from "./media-processing.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),archived_at TEXT,archived_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_chat_messages (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,sender TEXT NOT NULL CHECK(sender IN ('user','director')),content TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE media_video_briefs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,logline TEXT NOT NULL,audience TEXT NOT NULL,style TEXT NOT NULL,duration_seconds INTEGER NOT NULL,constraints_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'DRAFT',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PLANNED',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PENDING',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_brand_kits (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,colors_json TEXT NOT NULL DEFAULT '[]',fonts_json TEXT NOT NULL DEFAULT '[]',tagline TEXT NOT NULL DEFAULT '',tone TEXT NOT NULL DEFAULT '',disclaimer TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_presenter_profiles (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,appearance_prompt TEXT NOT NULL DEFAULT '',voice_accent TEXT NOT NULL DEFAULT '',clothing TEXT NOT NULL DEFAULT '',consistency_rules TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_generation_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'STUBBED',request_json TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_render_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),progress INTEGER NOT NULL DEFAULT 0,output_asset_id TEXT,request_json TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  return db;
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "now");
};

function idFactory(prefix: string) {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

async function readyProject(db: Database.Database, storageRoot: string) {
  createMediaProject(db, { id: "media-1", name: "Render", now: "created" }, audit(db));
  const bundle = await addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short cinematic product video.", now: "chat", createId: idFactory("id") }, audit(db));
  for (const scene of bundle.scenes) {
    updateMediaScene(db, "media-1", scene.id, { title: scene.title, durationSeconds: scene.durationSeconds, dialogue: `Line ${scene.position}`, visualPrompt: scene.visualPrompt, aspectRatio: "16:9", status: "DRAFT", now: "edit" }, audit(db));
    approveMediaScene(db, "media-1", scene.id, "approved", audit(db));
    await uploadSceneAsset(db, "media-1", scene.id, { id: `asset-${scene.position}`, originalName: `${scene.position}.png`, mimeType: "image/png", bytes: Buffer.from(`asset-${scene.position}`), now: "upload", storageRoot }, audit(db));
  }
  return bundle.scenes.map((scene) => scene.id);
}

function writingRunner(storageRoot: string, calls: Array<{ command: string; args: string[] }> = []): ProcessRunner {
  return async (command, args) => {
    calls.push({ command, args });
    if (args.includes("-version")) return { stdout: "ffmpeg version", stderr: "", exitCode: 0 };
    const output = args[args.length - 1];
    if (typeof output === "string" && path.resolve(output).startsWith(path.resolve(storageRoot))) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, Buffer.from("rendered"));
    }
    return { stdout: "", stderr: "ok", exitCode: 0 };
  };
}

function renderOptions(storageRoot: string, runner: ProcessRunner, extra: Partial<RenderDraftOptions> = {}): RenderDraftOptions {
  return { jobId: "render-1", outputAssetId: "output-1", now: "render-time", storageRoot, runner, ...extra };
}

describe("media rendering", () => {
  it("reorders scenes and saves the sequence", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    try {
      const sceneIds = await readyProject(db, storageRoot);
      const reordered = reorderMediaScenes(db, "media-1", [sceneIds[2], sceneIds[0], sceneIds[1]], "reorder", audit(db));
      assert.deepEqual(reordered.map((scene) => scene.id), [sceneIds[2], sceneIds[0], sceneIds[1]]);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENES_REORDERED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("renders approved image scene assets into a draft output asset with captions", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      await readyProject(db, storageRoot);
      const job = await renderDraftVideo(db, "media-1", renderOptions(storageRoot, writingRunner(storageRoot, calls)), audit(db));
      const output = db.prepare("SELECT source,mime_type AS mimeType,local_path AS localPath,preview_path AS previewPath FROM media_assets WHERE id='output-1'").get() as { source: string; mimeType: string; localPath: string; previewPath: string };

      assert.equal(job.status, "COMPLETED");
      assert.equal(job.progress, 100);
      assert.equal(output.source, "local-render");
      assert.equal(output.mimeType, "video/mp4");
      assert.equal(output.previewPath, output.localPath);
      assert.equal(calls.some((call) => call.args.join(" ").includes("drawtext=text='Line 1'")), true);
      assert.equal(calls.some((call) => call.args.includes("-f") && call.args.includes("concat")), true);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_RENDER_COMPLETED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("mixes scene narration and background music while ducking music volume", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      const sceneIds = await readyProject(db, storageRoot);
      const narration = await uploadSceneAsset(db, "media-1", sceneIds[0] as string, {
        id: "voice-1",
        originalName: "voice.wav",
        mimeType: "audio/wav",
        bytes: Buffer.from("voice"),
        now: "voice-upload",
        storageRoot
      }, audit(db));
      updateAudioAssetSettings(db, "media-1", narration.id, {
        role: "NARRATION",
        volume: 1,
        trimStartSeconds: 0.5,
        trimEndSeconds: 4,
        fadeInSeconds: 0.25,
        fadeOutSeconds: 0.5,
        now: "voice-settings"
      }, audit(db));
      const music = await uploadProjectAsset(db, "media-1", {
        id: "music-1",
        originalName: "music.mp3",
        mimeType: "audio/mpeg",
        bytes: Buffer.from("music"),
        audioRole: "MUSIC",
        now: "music-upload",
        storageRoot
      }, audit(db));
      updateAudioAssetSettings(db, "media-1", music.id, { role: "MUSIC", volume: 1, fadeInSeconds: 1, fadeOutSeconds: 1, now: "music-settings" }, audit(db));
      selectProjectBackgroundMusic(db, "media-1", music.id, "music-select", audit(db));

      await renderDraftVideo(db, "media-1", renderOptions(storageRoot, writingRunner(storageRoot, calls)), audit(db));
      const sceneRender = calls.find((call) => call.args.includes(narration.localPath as string) && call.args.includes(music.localPath as string));
      assert.ok(sceneRender);
      const joined = sceneRender.args.join(" ");
      assert.match(joined, /-ss 0\.5/);
      assert.match(joined, /-t 3\.5/);
      assert.match(joined, /volume=1\.000/);
      assert.match(joined, /volume=0\.250/);
      assert.match(joined, /afade=t=in/);
      assert.match(joined, /amix=inputs=3/);
      assert.match(joined, /-map \[aout\]/);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("applies selected brand logo and disclaimer during draft rendering", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      await readyProject(db, storageRoot);
      const brand = createBrandKit(db, "media-1", { id: "brand-1", name: "S4", colors: [], fonts: [], tagline: "", tone: "", disclaimer: "Prototype footage", now: "brand" }, audit(db));
      const logo = await uploadLibraryAsset(db, "media-1", {
        id: "logo-1",
        ownerType: "brand",
        ownerId: brand.id,
        role: "logo",
        originalName: "logo.png",
        mimeType: "image/png",
        bytes: Buffer.from("logo"),
        now: "logo",
        storageRoot
      }, audit(db));
      selectMediaLibraryDefaults(db, "media-1", { brandKitId: brand.id, now: "defaults" }, audit(db));

      await renderDraftVideo(db, "media-1", renderOptions(storageRoot, writingRunner(storageRoot, calls)), audit(db));
      const sceneRender = calls.find((call) => call.args.includes(logo.localPath as string));
      assert.ok(sceneRender);
      const joined = sceneRender.args.join(" ");
      assert.match(joined, /overlay=W-w-32:32/);
      assert.match(joined, /Prototype footage/);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("blocks render when an approved scene asset is missing or QC failed", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    try {
      await readyProject(db, storageRoot);
      db.prepare("DELETE FROM media_assets WHERE id='asset-1'").run();
      assert.throws(() => validateRenderReadiness(db, "media-1"), /missing an image or video asset/);
      await uploadSceneAsset(db, "media-1", (db.prepare("SELECT id FROM media_scenes WHERE position=1").get() as { id: string }).id, { id: "asset-1b", originalName: "bad.mp4", mimeType: "video/mp4", bytes: Buffer.from("bad"), now: "upload", storageRoot }, audit(db));
      db.prepare("UPDATE media_assets SET qc_status='FAILED' WHERE id='asset-1b'").run();
      assert.throws(() => validateRenderReadiness(db, "media-1"), /failed QC/);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("audits render failure when FFmpeg fails", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-render-"));
    try {
      await readyProject(db, storageRoot);
      const runner: ProcessRunner = async (_command, args) => args.includes("-version") ? { stdout: "version", stderr: "", exitCode: 0 } : { stdout: "", stderr: "boom", exitCode: 1 };
      await assert.rejects(() => renderDraftVideo(db, "media-1", renderOptions(storageRoot, runner), audit(db)), /FFmpeg scene render failed/);
      const job = db.prepare("SELECT status,error FROM media_render_jobs WHERE id='render-1'").get() as { status: string; error: string };
      assert.equal(job.status, "FAILED");
      assert.match(job.error, /FFmpeg scene render failed/);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_RENDER_FAILED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("records render cancellation", async () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Cancel", now: "created" }, audit(db));
    db.prepare("INSERT INTO media_render_jobs (id,media_project_id,status,progress,request_json,created_at,updated_at) VALUES ('job-1','media-1','QUEUED',0,'{}','now','now')").run();
    const job = cancelRenderJob(db, "media-1", "job-1", "cancelled", audit(db));
    assert.equal(job.status, "CANCELLED");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_RENDER_CANCELLED'").get() as { count: number }).count, 1);
  });
});
