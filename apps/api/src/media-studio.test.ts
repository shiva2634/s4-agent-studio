import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { addDirectorChatMessage, approveMediaBrief, approveMediaScene, archiveMediaProject, createMediaProject, deleteSceneAsset, exportMediaProductionPackage, getSceneFlowPrompt, importSceneAsset, listMediaProjects, mediaAssetMaxBytes, mediaProviderRegistry, replaceSceneAsset, updateMediaBrief, updateMediaScene, uploadSceneAsset } from "./media-studio.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
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

async function tempStorage() {
  return fs.mkdtemp(path.join(os.tmpdir(), "s4-media-assets-"));
}

describe("media studio", () => {
  it("creates active media projects and provider job stubs", () => {
    const db = dbFixture();

    const project = createMediaProject(db, { id: "media-1", name: "Launch Film", description: "Short launch video", now: "created" }, audit(db));

    assert.equal(project.status, "ACTIVE");
    assert.equal(project.description, "Short launch video");
    assert.deepEqual(listMediaProjects(db).map((item) => item.id), ["media-1"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_generation_jobs WHERE media_project_id='media-1' AND status='STUBBED'").get() as { count: number }).count, mediaProviderRegistry.length);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROJECT_CREATED'").get() as { count: number }).count, 1);
  });

  it("persists chat messages and deterministic brief records", () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Explainer", now: "created" }, audit(db));

    const bundle = addDirectorChatMessage(db, {
      projectId: "media-1",
      message: "Create a short cinematic product video for customers about S4 Media Studio.",
      now: "chat-time",
      createId: idFactory("id")
    }, audit(db));

    assert.equal(bundle.messages.length, 2);
    assert.equal(bundle.messages[0]?.sender, "user");
    assert.equal(bundle.messages[1]?.sender, "director");
    assert.equal(bundle.brief?.title, "Create A Short Cinematic Product Video For Customers");
    assert.equal(bundle.brief?.style, "Cinematic");
    assert.equal(bundle.brief?.audience, "Customers");
    assert.equal(bundle.brief?.status, "DRAFT");
    assert.equal(bundle.scenes.length, 3);
    assert.equal(bundle.scenes[0]?.status, "DRAFT");
    assert.equal(bundle.scenes[0]?.aspectRatio, "16:9");
    assert.equal(bundle.assets.length, 3);
    assert.equal(bundle.generationJobs.length, mediaProviderRegistry.length);
    assert.ok(bundle.messages[1]?.content.includes("Draft brief"));
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_DIRECTOR_BRIEF_UPDATED'").get() as { count: number }).count, 1);
  });

  it("archives media projects without deleting chat or brief history", () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Archive Me", now: "created" }, audit(db));
    addDirectorChatMessage(db, { projectId: "media-1", message: "Explain the product to investors in one minute.", now: "chat-time", createId: idFactory("chat") }, audit(db));

    const archived = archiveMediaProject(db, "media-1", "archived", audit(db));

    assert.equal(archived.status, "ARCHIVED");
    assert.deepEqual(listMediaProjects(db), []);
    assert.equal(listMediaProjects(db, true).length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_chat_messages WHERE media_project_id='media-1'").get() as { count: number }).count, 2);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_video_briefs WHERE media_project_id='media-1'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_PROJECT_ARCHIVED'").get() as { count: number }).count, 1);
  });

  it("edits and approves video briefs and scenes", () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Flow Companion", now: "created" }, audit(db));
    const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a cinematic launch film.", now: "chat-time", createId: idFactory("chat") }, audit(db));
    const sceneId = bundle.scenes[0]?.id as string;

    const brief = updateMediaBrief(db, "media-1", {
      title: "Editable Flow Brief",
      logline: "A polished Flow-ready launch sequence.",
      audience: "Customers",
      style: "Cinematic",
      durationSeconds: 42,
      constraints: ["Use generated assets only"],
      now: "brief-edit"
    }, audit(db));
    const approvedBrief = approveMediaBrief(db, "media-1", "brief-approved", audit(db));
    const scene = updateMediaScene(db, "media-1", sceneId, {
      title: "Opening Reveal",
      durationSeconds: 12,
      dialogue: "Welcome to the new studio.",
      visualPrompt: "A clean tracking shot across a local-first creative workspace.",
      aspectRatio: "16:9",
      status: "DRAFT",
      now: "scene-edit"
    }, audit(db));
    const approvedScene = approveMediaScene(db, "media-1", sceneId, "scene-approved", audit(db));
    const prompt = getSceneFlowPrompt(db, "media-1", sceneId).prompt;

    assert.equal(brief.status, "DRAFT");
    assert.equal(approvedBrief.status, "APPROVED");
    assert.equal(scene.visualPrompt, "A clean tracking shot across a local-first creative workspace.");
    assert.equal(approvedScene.status, "APPROVED");
    assert.ok(prompt.includes("Scene: Opening Reveal"));
    assert.ok(prompt.includes("Dialogue:\nWelcome to the new studio."));
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_BRIEF_APPROVED'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_APPROVED'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_FLOW_PROMPT_UPDATED'").get() as { count: number }).count, 1);
  });

  it("exports a complete production package as JSON-ready data", () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Export Film", now: "created" }, audit(db));
    const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short product video for customers.", now: "chat-time", createId: idFactory("chat") }, audit(db));
    const sceneId = bundle.scenes[0]?.id as string;
    importSceneAsset(db, "media-1", sceneId, {
      id: "asset-1",
      fileName: "opening.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1200,
      now: "asset-time"
    }, audit(db));

    const exported = exportMediaProductionPackage(db, "media-1", "exported");

    assert.equal(exported.exportedAt, "exported");
    assert.equal(exported.project.id, "media-1");
    assert.equal(exported.brief?.constraints.includes("No external AI calls"), true);
    assert.equal(exported.scenes.length, 3);
    assert.equal(exported.scenes[0]?.assets[0]?.fileName, "opening.mp4");
    assert.ok(exported.scenes[0]?.flowPrompt.includes("Output guidance:"));
    assert.doesNotThrow(() => JSON.stringify(exported));
  });

  it("validates and associates imported scene assets", () => {
    const db = dbFixture();
    createMediaProject(db, { id: "media-1", name: "Assets", now: "created" }, audit(db));
    const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
    const sceneId = bundle.scenes[0]?.id as string;

    const asset = importSceneAsset(db, "media-1", sceneId, {
      id: "asset-1",
      fileName: "frame.png",
      mimeType: "image/png",
      sizeBytes: 500,
      label: "Approved frame",
      now: "asset-time"
    }, audit(db));

    assert.equal(asset.kind, "image");
    assert.equal(asset.sceneId, sceneId);
    assert.equal(asset.label, "Approved frame");
    assert.equal(asset.mimeType, "image/png");
    assert.equal((db.prepare("SELECT status FROM media_scenes WHERE id=?").get(sceneId) as { status: string }).status, "ASSET_READY");
    assert.throws(() => importSceneAsset(db, "media-1", sceneId, {
      id: "asset-2",
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      now: "bad-asset"
    }, audit(db)), /Only allowed image, video, and audio assets/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_ASSET_IMPORTED'").get() as { count: number }).count, 1);
  });

  it("uploads image and video assets to local storage and associates them with scenes", async () => {
    const db = dbFixture();
    const storageRoot = await tempStorage();
    try {
      createMediaProject(db, { id: "media-1", name: "Upload", now: "created" }, audit(db));
      const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
      const sceneId = bundle.scenes[0]?.id as string;

      const asset = await uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-1",
        originalName: "opening shot.png",
        mimeType: "image/png",
        bytes: Buffer.from("png-bytes"),
        now: "upload-time",
        storageRoot
      }, audit(db));

      assert.equal(asset.originalName, "opening shot.png");
      assert.equal(asset.fileName, "asset-1-opening-shot.png");
      assert.equal(asset.mimeType, "image/png");
      assert.equal(asset.sizeBytes, 9);
      assert.equal(asset.checksumSha256, "ea80334363eed145dfeee51ebae7dc3f1cd7d0c7879f8bfd2070c061d3c33f56");
      assert.equal(asset.sceneId, sceneId);
      assert.ok(asset.localPath?.startsWith(storageRoot));
      assert.equal(await fs.readFile(asset.localPath as string, "utf8"), "png-bytes");
      assert.equal((db.prepare("SELECT status FROM media_scenes WHERE id=?").get(sceneId) as { status: string }).status, "ASSET_READY");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_ASSET_UPLOADED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid MIME types and oversized uploads", async () => {
    const db = dbFixture();
    const storageRoot = await tempStorage();
    try {
      createMediaProject(db, { id: "media-1", name: "Upload", now: "created" }, audit(db));
      const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
      const sceneId = bundle.scenes[0]?.id as string;

      await assert.rejects(() => uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-1",
        originalName: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("text"),
        now: "upload-time",
        storageRoot
      }, audit(db)), /Only allowed image, video, and audio MIME types/);

      await assert.rejects(() => uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-2",
        originalName: "huge.mp4",
        mimeType: "video/mp4",
        bytes: Buffer.allocUnsafe(mediaAssetMaxBytes + 1),
        now: "upload-time",
        storageRoot
      }, audit(db)), /exceeds the size limit/);

      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE media_project_id='media-1'").get() as { count: number }).count, 3);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("replaces uploaded assets and removes the old file", async () => {
    const db = dbFixture();
    const storageRoot = await tempStorage();
    try {
      createMediaProject(db, { id: "media-1", name: "Replace", now: "created" }, audit(db));
      const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
      const sceneId = bundle.scenes[0]?.id as string;
      const original = await uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-1",
        originalName: "frame.png",
        mimeType: "image/png",
        bytes: Buffer.from("first"),
        now: "upload-time",
        storageRoot
      }, audit(db));

      const replacement = await replaceSceneAsset(db, "media-1", sceneId, "asset-1", {
        originalName: "clip.mp4",
        mimeType: "video/mp4",
        bytes: Buffer.from("second"),
        now: "replace-time",
        storageRoot
      }, audit(db));

      await assert.rejects(() => fs.stat(original.localPath as string), /ENOENT/);
      assert.equal(await fs.readFile(replacement.localPath as string, "utf8"), "second");
      assert.equal(replacement.originalName, "clip.mp4");
      assert.equal(replacement.mimeType, "video/mp4");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE id='asset-1'").get() as { count: number }).count, 1);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_ASSET_REPLACED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("deletes uploaded asset files while preserving audit records", async () => {
    const db = dbFixture();
    const storageRoot = await tempStorage();
    try {
      createMediaProject(db, { id: "media-1", name: "Delete", now: "created" }, audit(db));
      const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
      const sceneId = bundle.scenes[0]?.id as string;
      const asset = await uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-1",
        originalName: "frame.png",
        mimeType: "image/png",
        bytes: Buffer.from("delete-me"),
        now: "upload-time",
        storageRoot
      }, audit(db));

      await deleteSceneAsset(db, "media-1", sceneId, "asset-1", "delete-time", audit(db), storageRoot);

      await assert.rejects(() => fs.stat(asset.localPath as string), /ENOENT/);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE id='asset-1'").get() as { count: number }).count, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_ASSET_DELETED'").get() as { count: number }).count, 1);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects traversal in uploaded filenames", async () => {
    const db = dbFixture();
    const storageRoot = await tempStorage();
    try {
      createMediaProject(db, { id: "media-1", name: "Traversal", now: "created" }, audit(db));
      const bundle = addDirectorChatMessage(db, { projectId: "media-1", message: "Create a short video.", now: "chat-time", createId: idFactory("chat") }, audit(db));
      const sceneId = bundle.scenes[0]?.id as string;

      await assert.rejects(() => uploadSceneAsset(db, "media-1", sceneId, {
        id: "asset-1",
        originalName: "../escape.png",
        mimeType: "image/png",
        bytes: Buffer.from("png"),
        now: "upload-time",
        storageRoot
      }, audit(db)), /must not include a path/);

      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_SCENE_ASSET_UPLOADED'").get() as { count: number }).count, 0);
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
