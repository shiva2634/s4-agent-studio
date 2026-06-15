import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { addDirectorChatMessage, createMediaProject, updateMediaScene, uploadSceneAsset } from "./media-studio.js";
import { detectFfmpeg, processMediaAsset, type ProcessRunner } from "./media-processing.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      default_brand_kit_id TEXT,
      default_presenter_profile_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      archived_at TEXT,
      archived_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_chat_messages (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('user','director')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE media_video_briefs (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      logline TEXT NOT NULL,
      audience TEXT NOT NULL,
      style TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      constraints_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_scenes (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL,
      brief_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      dialogue TEXT NOT NULL DEFAULT '',
      visual_prompt TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL,
      scene_id TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      file_name TEXT,
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      checksum_sha256 TEXT,
      local_path TEXT,
      inspection_json TEXT,
      qc_status TEXT NOT NULL DEFAULT 'PENDING',
      qc_issues_json TEXT NOT NULL DEFAULT '[]',
      preview_path TEXT,
      thumbnail_path TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_brand_kits (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,colors_json TEXT NOT NULL DEFAULT '[]',fonts_json TEXT NOT NULL DEFAULT '[]',tagline TEXT NOT NULL DEFAULT '',tone TEXT NOT NULL DEFAULT '',disclaimer TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_presenter_profiles (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,name TEXT NOT NULL,appearance_prompt TEXT NOT NULL DEFAULT '',voice_accent TEXT NOT NULL DEFAULT '',clothing TEXT NOT NULL DEFAULT '',consistency_rules TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE media_generation_jobs (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'STUBBED',
      request_json TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_processing_jobs (
      id TEXT PRIMARY KEY,
      media_project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
      operation TEXT NOT NULL,
      log_text TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
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

async function fixtureAsset(db: Database.Database, storageRoot: string, mimeType = "video/mp4") {
  createMediaProject(db, { id: "media-1", name: "Processing", now: "created" }, audit(db));
  const bundle = await addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
  const sceneId = bundle.scenes[0]?.id as string;
  updateMediaScene(db, "media-1", sceneId, {
    title: "QC Scene",
    durationSeconds: 10,
    dialogue: "Hello",
    visualPrompt: "Wide shot",
    aspectRatio: "16:9",
    status: "DRAFT",
    now: "scene-edit"
  }, audit(db));
  const asset = await uploadSceneAsset(db, "media-1", sceneId, {
    id: "asset-1",
    originalName: mimeType.startsWith("audio/") ? "voice.mp3" : "clip.mp4",
    mimeType,
    bytes: Buffer.from("media"),
    now: "upload-time",
    storageRoot
  }, audit(db));
  return { sceneId, asset };
}

function okRunner(probeJson: unknown, calls: Array<{ command: string; args: string[] }> = []): ProcessRunner {
  return async (command, args) => {
    calls.push({ command, args });
    if (args.includes("-version")) return { stdout: `${command} version test`, stderr: "", exitCode: 0 };
    if (args.includes("-show_streams")) return { stdout: JSON.stringify(probeJson), stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("media processing", () => {
  it("detects configured ffmpeg and ffprobe binaries", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const status = await detectFfmpeg({
      ffmpegPath: "custom-ffmpeg",
      ffprobePath: "custom-ffprobe",
      runner: okRunner({}, calls)
    });

    assert.equal(status.available, true);
    assert.deepEqual(calls.map((call) => call.command), ["custom-ffmpeg", "custom-ffprobe"]);
  });

  it("stores inspection metadata, QC issues, processing job status, proxy, and thumbnail paths", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-processing-"));
    try {
      const { asset } = await fixtureAsset(db, storageRoot);
      const result = await processMediaAsset(db, "media-1", asset.id, {
        jobId: "job-1",
        now: "processed",
        storageRoot,
        runner: okRunner({
          streams: [
            { codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30000/1001" }
          ],
          format: { duration: "12.25" }
        })
      }, audit(db));

      const stored = db.prepare("SELECT inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath FROM media_assets WHERE id='asset-1'").get() as any;
      const job = db.prepare("SELECT status FROM media_processing_jobs WHERE id='job-1'").get() as { status: string };

      assert.equal(result.status, "COMPLETED");
      assert.equal(job.status, "COMPLETED");
      assert.equal(stored.qcStatus, "ISSUES");
      assert.ok(stored.previewPath.endsWith("preview.mp4"));
      assert.ok(stored.thumbnailPath.endsWith("thumbnail.jpg"));
      assert.equal(JSON.parse(stored.inspectionJson).videoCodec, "h264");
      assert.deepEqual(JSON.parse(stored.qcIssuesJson).map((issue: { code: string }) => issue.code), ["MISSING_AUDIO", "DURATION_MISMATCH", "LOW_RESOLUTION"]);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROCESSING_COMPLETED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("stores audio inspection metadata without requiring video derivatives", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-processing-"));
    try {
      const { asset } = await fixtureAsset(db, storageRoot, "audio/mpeg");
      const result = await processMediaAsset(db, "media-1", asset.id, {
        jobId: "job-1",
        now: "processed",
        storageRoot,
        runner: okRunner({
          streams: [
            { codec_type: "audio", codec_name: "mp3" }
          ],
          format: { duration: "10" }
        })
      }, audit(db));
      const stored = db.prepare("SELECT inspection_json AS inspectionJson,qc_status AS qcStatus,preview_path AS previewPath,thumbnail_path AS thumbnailPath FROM media_assets WHERE id='asset-1'").get() as { inspectionJson: string; qcStatus: string; previewPath: string | null; thumbnailPath: string | null };
      const inspection = JSON.parse(stored.inspectionJson) as { hasAudio: boolean; hasVideo: boolean; audioCodec: string; durationSeconds: number };

      assert.equal(result.status, "COMPLETED");
      assert.equal(stored.qcStatus, "PASSED");
      assert.equal(inspection.hasAudio, true);
      assert.equal(inspection.hasVideo, false);
      assert.equal(inspection.audioCodec, "mp3");
      assert.equal(inspection.durationSeconds, 10);
      assert.equal(stored.previewPath, null);
      assert.equal(stored.thumbnailPath, null);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("records wrong aspect ratio QC issues", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-processing-"));
    try {
      const { asset } = await fixtureAsset(db, storageRoot);
      const result = await processMediaAsset(db, "media-1", asset.id, {
        jobId: "job-1",
        now: "processed",
        storageRoot,
        runner: okRunner({
          streams: [
            { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "24/1" },
            { codec_type: "audio", codec_name: "aac" }
          ],
          format: { duration: "10" }
        })
      }, audit(db));

      assert.equal(result.qcIssues.some((issue) => issue.code === "WRONG_ASPECT_RATIO"), true);
      assert.equal(result.qcStatus, "ISSUES");
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("gracefully records FFmpeg unavailable without crashing processing", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-processing-"));
    try {
      const { asset } = await fixtureAsset(db, storageRoot);
      const result = await processMediaAsset(db, "media-1", asset.id, {
        jobId: "job-1",
        now: "processed",
        storageRoot,
        runner: async () => { throw new Error("not found"); }
      }, audit(db));

      const stored = db.prepare("SELECT qc_status AS qcStatus FROM media_assets WHERE id='asset-1'").get() as { qcStatus: string };
      const job = db.prepare("SELECT status,error FROM media_processing_jobs WHERE id='job-1'").get() as { status: string; error: string };

      assert.equal(result.ffmpegAvailable, false);
      assert.equal(result.status, "FAILED");
      assert.equal(stored.qcStatus, "SKIPPED");
      assert.equal(job.status, "FAILED");
      assert.match(job.error, /unavailable/i);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROCESSING_SKIPPED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("marks unreadable files as failed QC when ffprobe fails", async () => {
    const db = dbFixture();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s4-processing-"));
    try {
      const { asset } = await fixtureAsset(db, storageRoot);
      const runner: ProcessRunner = async (_command, args) => {
        if (args.includes("-version")) return { stdout: "version", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "invalid data", exitCode: 1 };
      };
      const result = await processMediaAsset(db, "media-1", asset.id, { jobId: "job-1", now: "processed", storageRoot, runner }, audit(db));

      const stored = db.prepare("SELECT qc_status AS qcStatus,qc_issues_json AS qcIssuesJson FROM media_assets WHERE id='asset-1'").get() as { qcStatus: string; qcIssuesJson: string };

      assert.equal(result.status, "FAILED");
      assert.equal(stored.qcStatus, "FAILED");
      assert.equal(JSON.parse(stored.qcIssuesJson)[0].code, "UNREADABLE_FILE");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROCESSING_FAILED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
