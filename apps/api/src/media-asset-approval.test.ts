import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  approveGeneratedMediaAsset,
  buildGeneratedAssetMetadata,
  getMediaAssetApproval,
  rejectGeneratedMediaAsset,
  resetGeneratedAssetApproval
} from "./media-studio.js";
import { validateExportReadiness } from "./media-rendering.js";

function dbFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE media_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,aspect_ratio TEXT NOT NULL DEFAULT '16:9',default_brand_kit_id TEXT,default_presenter_profile_id TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',archived_at TEXT,archived_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_scenes (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,brief_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,duration_seconds INTEGER NOT NULL,dialogue TEXT NOT NULL DEFAULT '',visual_prompt TEXT NOT NULL DEFAULT '',aspect_ratio TEXT NOT NULL DEFAULT '16:9',status TEXT NOT NULL DEFAULT 'APPROVED',approved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,scene_id TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'READY',file_name TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,checksum_sha256 TEXT,local_path TEXT,inspection_json TEXT,qc_status TEXT NOT NULL DEFAULT 'PASSED',qc_issues_json TEXT NOT NULL DEFAULT '[]',preview_path TEXT,thumbnail_path TEXT,metadata_json TEXT,approval_status TEXT,approval_feedback TEXT,approved_at TEXT,approved_by TEXT,rejected_at TEXT,rejected_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE media_render_jobs (id TEXT PRIMARY KEY,media_project_id TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,output_asset_id TEXT,request_json TEXT NOT NULL,log_text TEXT NOT NULL DEFAULT '',error TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,project_id TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-1','Project','','16:9','now','now')").run();
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,created_at,updated_at) VALUES ('media-2','Other','','16:9','now','now')").run();
  db.prepare(`INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,approved_at,created_at,updated_at)
    VALUES ('scene-1','media-1','brief-1',1,'Opening','',4,'Line','Prompt','16:9','APPROVED','approved','now','now')`).run();
  return db;
}

const audit = (db: Database.Database) => (eventType: string, summary: string, values: { projectId?: string; payload?: unknown } = {}) => {
  db.prepare("INSERT INTO audit_events (id,project_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), values.projectId ?? null, eventType, summary, values.payload ? JSON.stringify(values.payload) : null, "audit");
};

function insertGeneratedAsset(db: Database.Database, id = "asset-1", status: string | null = null) {
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,qc_status,qc_issues_json,metadata_json,approval_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    "media-1",
    "scene-1",
    "video",
    `Generated ${id}`,
    "ovi",
    "READY",
    `${id}.mp4`,
    `${id}.mp4`,
    "video/mp4",
    12,
    "checksum",
    `C:/media/${id}.mp4`,
    "PASSED",
    "[]",
    "{}",
    status,
    id,
    id
  );
}

describe("generated media asset approval", () => {
  it("defaults newly generated assets to pending", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1");
    resetGeneratedAssetApproval(db, "asset-1", "generated");

    assert.equal(getMediaAssetApproval(db, "media-1", "asset-1").approvalStatus, "PENDING");
  });

  it("approves generated assets and records an audit event", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "PENDING");

    const asset = approveGeneratedMediaAsset(db, "media-1", "asset-1", { now: "approved", actor: "tester" }, audit(db));
    const count = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_GENERATED_ASSET_APPROVED'").get() as { count: number };

    assert.equal(asset.approvalStatus, "APPROVED");
    assert.equal(asset.approvedBy, "tester");
    assert.equal(asset.approvalFeedback, null);
    assert.equal(count.count, 1);
  });

  it("rejects generated assets with trimmed feedback and records an audit event", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "PENDING");

    const asset = rejectGeneratedMediaAsset(db, "media-1", "asset-1", { feedback: "  crop is wrong  ", now: "rejected", actor: "tester" }, audit(db));
    const count = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='MEDIA_GENERATED_ASSET_REJECTED'").get() as { count: number };

    assert.equal(asset.approvalStatus, "REJECTED");
    assert.equal(asset.approvalFeedback, "crop is wrong");
    assert.equal(asset.rejectedBy, "tester");
    assert.equal(count.count, 1);
  });

  it("requires bounded rejection feedback", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "PENDING");

    assert.throws(() => rejectGeneratedMediaAsset(db, "media-1", "asset-1", { feedback: "   ", now: "rejected" }, audit(db)), /feedback is required/);
    assert.throws(() => rejectGeneratedMediaAsset(db, "media-1", "asset-1", { feedback: "x".repeat(2_001), now: "rejected" }, audit(db)), /2000 characters/);
  });

  it("rejects project access mismatches", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "PENDING");

    assert.throws(() => getMediaAssetApproval(db, "media-2", "asset-1"), /Media asset not found/);
    assert.throws(() => approveGeneratedMediaAsset(db, "media-2", "asset-1", { now: "approved" }, audit(db)), /Media asset not found/);
  });

  it("blocks final export for pending generated assets", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "PENDING");

    assert.throws(() => validateExportReadiness(db, "media-1", { preset: "16:9", resolution: "720p", fps: 24, bitrateKbps: 2500, includeLogo: false }), /must be approved.*PENDING/);
  });

  it("blocks final export for rejected generated assets", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "REJECTED");

    assert.throws(() => validateExportReadiness(db, "media-1", { preset: "16:9", resolution: "720p", fps: 24, bitrateKbps: 2500, includeLogo: false }), /must be approved.*REJECTED/);
  });

  it("allows final export for approved generated assets", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-1", "APPROVED");

    const readiness = validateExportReadiness(db, "media-1", { preset: "16:9", resolution: "720p", fps: 24, bitrateKbps: 2500, includeLogo: false });

    assert.equal(readiness.ready, true);
    assert.equal(readiness.sceneCount, 1);
  });

  it("creates regenerated assets as pending while preserving the previous decision", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-old", "APPROVED");

    const metadata = buildGeneratedAssetMetadata(db, "media-1", "scene-1", { provider: "ovi" });
    insertGeneratedAsset(db, "asset-new");
    db.prepare("UPDATE media_assets SET metadata_json=? WHERE id='asset-new'").run(JSON.stringify(metadata));
    resetGeneratedAssetApproval(db, "asset-new", "regenerated");

    const oldApproval = getMediaAssetApproval(db, "media-1", "asset-old");
    const replacement = db.prepare("SELECT approval_status AS approvalStatus,metadata_json AS metadataJson FROM media_assets WHERE id='asset-new'").get() as { approvalStatus: string; metadataJson: string };

    assert.equal(oldApproval.approvalStatus, "APPROVED");
    assert.equal(replacement.approvalStatus, "PENDING");
    assert.equal(JSON.parse(replacement.metadataJson).previousGeneratedAssetId, "asset-old");
  });

  it("does not reset an existing decision when a later generated asset completes", () => {
    const db = dbFixture();
    insertGeneratedAsset(db, "asset-old", "REJECTED");
    insertGeneratedAsset(db, "asset-late");
    resetGeneratedAssetApproval(db, "asset-late", "late");

    assert.equal(getMediaAssetApproval(db, "media-1", "asset-old").approvalStatus, "REJECTED");
    assert.equal(getMediaAssetApproval(db, "media-1", "asset-late").approvalStatus, "PENDING");
  });
});
