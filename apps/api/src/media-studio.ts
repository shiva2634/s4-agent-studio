import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeProviderError } from "./ai-provider.js";
import type { VideoDirectorPlan, VideoDirectorProviderResult, VideoDirectorScene } from "./media-director-provider.js";

export type MediaProjectStatus = "ACTIVE" | "ARCHIVED";
export type MediaSender = "user" | "director";
export type MediaBriefStatus = "DRAFT" | "APPROVED";
export type MediaSceneStatus = "DRAFT" | "APPROVED" | "GENERATING" | "ASSET_READY" | "REJECTED";
export type MediaAudioRole = "NARRATION" | "MUSIC" | "SFX" | "SCENE_AUDIO";
export type MediaLibraryAssetOwner = "brand" | "presenter";

export type MediaAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; payload?: unknown }) => void;

export type IdFactory = () => string;

export const mediaAssetMaxBytes = 100 * 1024 * 1024;
export const mediaAssetMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav"
]);

export class MediaStudioError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export type MediaProject = {
  id: string;
  name: string;
  description: string | null;
  aspectRatio: string;
  defaultBrandKitId: string | null;
  defaultPresenterProfileId: string | null;
  status: MediaProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type MediaChatMessage = {
  id: string;
  mediaProjectId: string;
  sender: MediaSender;
  content: string;
  createdAt: string;
};

export type MediaBrief = {
  id: string;
  mediaProjectId: string;
  title: string;
  logline: string;
  audience: string;
  style: string;
  durationSeconds: number;
  constraintsJson: string;
  status: MediaBriefStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaScene = {
  id: string;
  mediaProjectId: string;
  briefId: string;
  position: number;
  title: string;
  description: string;
  durationSeconds: number;
  dialogue: string;
  visualPrompt: string;
  aspectRatio: string;
  status: MediaSceneStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaAsset = {
  id: string;
  mediaProjectId: string;
  sceneId: string | null;
  kind: string;
  label: string;
  source: string;
  status: string;
  fileName: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  localPath: string | null;
  inspectionJson: string | null;
  qcStatus: string;
  qcIssuesJson: string;
  previewPath: string | null;
  thumbnailPath: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaGenerationJob = {
  id: string;
  mediaProjectId: string;
  providerKey: string;
  status: string;
  requestJson: string;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaBrandKit = {
  id: string;
  mediaProjectId: string;
  name: string;
  colorsJson: string;
  fontsJson: string;
  tagline: string;
  tone: string;
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MediaPresenterProfile = {
  id: string;
  mediaProjectId: string;
  name: string;
  appearancePrompt: string;
  voiceAccent: string;
  clothing: string;
  consistencyRules: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const mediaProviderRegistry = [
  { key: "google-flow", name: "Google Flow", capabilities: ["storyboard", "video-generation"], status: "stubbed" },
  { key: "wan-2.2", name: "Wan 2.2", capabilities: ["text-to-video", "image-to-video"], status: "stubbed" },
  { key: "longcat-avatar", name: "LongCat Avatar", capabilities: ["avatar-video"], status: "stubbed" },
  { key: "ovi", name: "Ovi", capabilities: ["text-to-video"], status: "stubbed" },
  { key: "ltx", name: "LTX", capabilities: ["video-generation", "editing"], status: "stubbed" }
] as const;

type BriefDraft = {
  title: string;
  logline: string;
  audience: string;
  style: string;
  durationSeconds: number;
  constraints: string[];
  script?: string;
  scenes: Array<{ title: string; description: string; durationSeconds: number; dialogue?: string; visualPrompt?: string; aspectRatio?: string; assetLabel: string }>;
};

export type VideoDirectorProvider = {
  generatePlan(input: { projectName: string; projectDescription: string | null; userIdea: string; existingContext: unknown }): Promise<VideoDirectorProviderResult<VideoDirectorPlan>>;
  generateScene(input: { projectName: string; projectDescription: string | null; userIdea: string; existingBrief: unknown; existingScene: unknown }): Promise<VideoDirectorProviderResult<VideoDirectorScene>>;
};

export type MediaProductionPackage = {
  exportedAt: string;
  project: MediaProject;
  brief: (Omit<MediaBrief, "constraintsJson"> & { constraints: string[] }) | null;
  scenes: Array<MediaScene & { flowPrompt: string; assets: MediaAsset[] }>;
  assets: MediaAsset[];
  brandKits: MediaBrandKit[];
  presenterProfiles: MediaPresenterProfile[];
};

export function listMediaProjects(db: Database.Database, includeArchived = false): MediaProject[] {
  const where = includeArchived ? "" : "WHERE status='ACTIVE'";
  return db.prepare(`SELECT id,name,description,aspect_ratio AS aspectRatio,default_brand_kit_id AS defaultBrandKitId,default_presenter_profile_id AS defaultPresenterProfileId,status,created_at AS createdAt,updated_at AS updatedAt FROM media_projects ${where} ORDER BY created_at DESC`).all() as MediaProject[];
}

export function createMediaProject(db: Database.Database, input: { id: string; name: string; description?: string; now: string }, audit: MediaAuditWriter): MediaProject {
  db.prepare("INSERT INTO media_projects (id,name,description,aspect_ratio,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(input.id, input.name, input.description ?? null, "16:9", "ACTIVE", input.now, input.now);
  let jobIndex = 0;
  seedProviderJobs(db, input.id, input.now, () => `${input.id}-job-${++jobIndex}`);
  audit("MEDIA_PROJECT_CREATED", `Media project ${input.name} created`, { projectId: input.id, payload: { name: input.name } });
  return getMediaProjectOrThrow(db, input.id);
}

export function updateMediaProject(db: Database.Database, projectId: string, input: { name?: string; description?: string; now: string }, audit: MediaAuditWriter): MediaProject {
  const existing = getActiveMediaProjectOrThrow(db, projectId);
  db.prepare("UPDATE media_projects SET name=?,description=?,updated_at=? WHERE id=?")
    .run(input.name ?? existing.name, input.description ?? existing.description, input.now, projectId);
  audit("MEDIA_PROJECT_UPDATED", `Media project ${input.name ?? existing.name} updated`, { projectId, payload: { name: input.name, description: input.description } });
  return getMediaProjectOrThrow(db, projectId);
}

export function createBrandKit(db: Database.Database, projectId: string, input: {
  id: string;
  name: string;
  colors: string[];
  fonts: string[];
  tagline: string;
  tone: string;
  disclaimer: string;
  now: string;
}, audit: MediaAuditWriter): MediaBrandKit {
  getActiveMediaProjectOrThrow(db, projectId);
  db.prepare(`INSERT INTO media_brand_kits (id,media_project_id,name,colors_json,fonts_json,tagline,tone,disclaimer,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, input.name, JSON.stringify(input.colors), JSON.stringify(input.fonts), input.tagline, input.tone, input.disclaimer, input.now, input.now);
  audit("MEDIA_BRAND_KIT_CREATED", `Brand kit ${input.name} created`, { projectId, payload: { brandKitId: input.id } });
  return getBrandKitOrThrow(db, projectId, input.id);
}

export function updateBrandKit(db: Database.Database, projectId: string, brandKitId: string, input: {
  name: string;
  colors: string[];
  fonts: string[];
  tagline: string;
  tone: string;
  disclaimer: string;
  now: string;
}, audit: MediaAuditWriter): MediaBrandKit {
  getActiveMediaProjectOrThrow(db, projectId);
  getBrandKitOrThrow(db, projectId, brandKitId);
  db.prepare(`UPDATE media_brand_kits SET name=?,colors_json=?,fonts_json=?,tagline=?,tone=?,disclaimer=?,updated_at=? WHERE id=? AND media_project_id=? AND deleted_at IS NULL`)
    .run(input.name, JSON.stringify(input.colors), JSON.stringify(input.fonts), input.tagline, input.tone, input.disclaimer, input.now, brandKitId, projectId);
  audit("MEDIA_BRAND_KIT_UPDATED", `Brand kit ${input.name} updated`, { projectId, payload: { brandKitId } });
  auditPromptContextChanged(db, projectId, input.now, audit);
  return getBrandKitOrThrow(db, projectId, brandKitId);
}

export function deleteBrandKit(db: Database.Database, projectId: string, brandKitId: string, timestamp: string, audit: MediaAuditWriter): { deleted: true } {
  getActiveMediaProjectOrThrow(db, projectId);
  const kit = getBrandKitOrThrow(db, projectId, brandKitId);
  db.prepare("UPDATE media_brand_kits SET deleted_at=?,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, timestamp, brandKitId, projectId);
  db.prepare("UPDATE media_projects SET default_brand_kit_id=NULL,updated_at=? WHERE id=? AND default_brand_kit_id=?").run(timestamp, projectId, brandKitId);
  audit("MEDIA_BRAND_KIT_DELETED", `Brand kit ${kit.name} deleted`, { projectId, payload: { brandKitId } });
  auditPromptContextChanged(db, projectId, timestamp, audit);
  return { deleted: true };
}

export function createPresenterProfile(db: Database.Database, projectId: string, input: {
  id: string;
  name: string;
  appearancePrompt: string;
  voiceAccent: string;
  clothing: string;
  consistencyRules: string;
  now: string;
}, audit: MediaAuditWriter): MediaPresenterProfile {
  getActiveMediaProjectOrThrow(db, projectId);
  db.prepare(`INSERT INTO media_presenter_profiles (id,media_project_id,name,appearance_prompt,voice_accent,clothing,consistency_rules,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, input.name, input.appearancePrompt, input.voiceAccent, input.clothing, input.consistencyRules, input.now, input.now);
  audit("MEDIA_PRESENTER_PROFILE_CREATED", `Presenter profile ${input.name} created`, { projectId, payload: { presenterProfileId: input.id } });
  return getPresenterProfileOrThrow(db, projectId, input.id);
}

export function updatePresenterProfile(db: Database.Database, projectId: string, presenterProfileId: string, input: {
  name: string;
  appearancePrompt: string;
  voiceAccent: string;
  clothing: string;
  consistencyRules: string;
  now: string;
}, audit: MediaAuditWriter): MediaPresenterProfile {
  getActiveMediaProjectOrThrow(db, projectId);
  getPresenterProfileOrThrow(db, projectId, presenterProfileId);
  db.prepare(`UPDATE media_presenter_profiles SET name=?,appearance_prompt=?,voice_accent=?,clothing=?,consistency_rules=?,updated_at=? WHERE id=? AND media_project_id=? AND deleted_at IS NULL`)
    .run(input.name, input.appearancePrompt, input.voiceAccent, input.clothing, input.consistencyRules, input.now, presenterProfileId, projectId);
  audit("MEDIA_PRESENTER_PROFILE_UPDATED", `Presenter profile ${input.name} updated`, { projectId, payload: { presenterProfileId } });
  auditPromptContextChanged(db, projectId, input.now, audit);
  return getPresenterProfileOrThrow(db, projectId, presenterProfileId);
}

export function deletePresenterProfile(db: Database.Database, projectId: string, presenterProfileId: string, timestamp: string, audit: MediaAuditWriter): { deleted: true } {
  getActiveMediaProjectOrThrow(db, projectId);
  const profile = getPresenterProfileOrThrow(db, projectId, presenterProfileId);
  db.prepare("UPDATE media_presenter_profiles SET deleted_at=?,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, timestamp, presenterProfileId, projectId);
  db.prepare("UPDATE media_projects SET default_presenter_profile_id=NULL,updated_at=? WHERE id=? AND default_presenter_profile_id=?").run(timestamp, projectId, presenterProfileId);
  audit("MEDIA_PRESENTER_PROFILE_DELETED", `Presenter profile ${profile.name} deleted`, { projectId, payload: { presenterProfileId } });
  auditPromptContextChanged(db, projectId, timestamp, audit);
  return { deleted: true };
}

export function selectMediaLibraryDefaults(db: Database.Database, projectId: string, input: { brandKitId?: string | null; presenterProfileId?: string | null; now: string }, audit: MediaAuditWriter): MediaProject {
  getActiveMediaProjectOrThrow(db, projectId);
  const existing = getMediaProjectOrThrow(db, projectId);
  const brandKitId = input.brandKitId === undefined ? existing.defaultBrandKitId : input.brandKitId;
  const presenterProfileId = input.presenterProfileId === undefined ? existing.defaultPresenterProfileId : input.presenterProfileId;
  if (brandKitId) getBrandKitOrThrow(db, projectId, brandKitId);
  if (presenterProfileId) getPresenterProfileOrThrow(db, projectId, presenterProfileId);
  db.prepare("UPDATE media_projects SET default_brand_kit_id=?,default_presenter_profile_id=?,updated_at=? WHERE id=?")
    .run(brandKitId ?? null, presenterProfileId ?? null, input.now, projectId);
  audit("MEDIA_LIBRARY_DEFAULTS_SELECTED", "Media library defaults selected", { projectId, payload: { brandKitId, presenterProfileId } });
  auditPromptContextChanged(db, projectId, input.now, audit);
  return getMediaProjectOrThrow(db, projectId);
}

export function archiveMediaProject(db: Database.Database, projectId: string, timestamp: string, audit: MediaAuditWriter): MediaProject & { alreadyArchived: boolean } {
  const project = db.prepare("SELECT id,name,description,aspect_ratio AS aspectRatio,default_brand_kit_id AS defaultBrandKitId,default_presenter_profile_id AS defaultPresenterProfileId,status,created_at AS createdAt,updated_at AS updatedAt FROM media_projects WHERE id=?").get(projectId) as MediaProject | undefined;
  if (!project) throw new MediaStudioError("Media project not found", 404);
  if (project.status === "ARCHIVED") return { ...project, alreadyArchived: true };
  db.prepare("UPDATE media_projects SET status='ARCHIVED',archived_at=?,archived_by=?,updated_at=? WHERE id=?")
    .run(timestamp, "local-user", timestamp, projectId);
  audit("MEDIA_PROJECT_ARCHIVED", `Media project ${project.name} archived`, {
    projectId,
    payload: { projectId, projectName: project.name, previousStatus: project.status, newStatus: "ARCHIVED", timestamp }
  });
  return { ...getMediaProjectOrThrow(db, projectId), alreadyArchived: false };
}

export function getMediaProjectBundle(db: Database.Database, projectId: string) {
  const project = getMediaProjectOrThrow(db, projectId);
  return {
    project,
    messages: listMediaMessages(db, projectId),
    brief: getMediaBrief(db, projectId),
    scenes: listMediaScenes(db, projectId),
    assets: listMediaAssets(db, projectId),
    brandKits: listBrandKits(db, projectId),
    presenterProfiles: listPresenterProfiles(db, projectId),
    generationJobs: listGenerationJobs(db, projectId),
    providers: mediaProviderRegistry
  };
}

export function updateMediaBrief(db: Database.Database, projectId: string, input: {
  title: string;
  logline: string;
  audience: string;
  style: string;
  durationSeconds: number;
  constraints: string[];
  now: string;
}, audit: MediaAuditWriter): MediaBrief {
  getActiveMediaProjectOrThrow(db, projectId);
  const existing = getMediaBrief(db, projectId);
  if (!existing) throw new MediaStudioError("Media brief not found", 404);
  db.prepare(`UPDATE media_video_briefs SET title=?,logline=?,audience=?,style=?,duration_seconds=?,constraints_json=?,status='DRAFT',approved_at=NULL,updated_at=? WHERE id=?`)
    .run(input.title, input.logline, input.audience, input.style, input.durationSeconds, JSON.stringify(input.constraints), input.now, existing.id);
  audit("MEDIA_BRIEF_UPDATED", `Video brief ${input.title} updated`, { projectId, payload: { briefId: existing.id } });
  return getMediaBrief(db, projectId) as MediaBrief;
}

export function approveMediaBrief(db: Database.Database, projectId: string, timestamp: string, audit: MediaAuditWriter): MediaBrief {
  getActiveMediaProjectOrThrow(db, projectId);
  const brief = getMediaBrief(db, projectId);
  if (!brief) throw new MediaStudioError("Media brief not found", 404);
  db.prepare("UPDATE media_video_briefs SET status='APPROVED',approved_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, brief.id);
  audit("MEDIA_BRIEF_APPROVED", `Video brief ${brief.title} approved`, { projectId, payload: { briefId: brief.id, timestamp } });
  return getMediaBrief(db, projectId) as MediaBrief;
}

export function updateMediaScene(db: Database.Database, projectId: string, sceneId: string, input: {
  title: string;
  durationSeconds: number;
  dialogue: string;
  visualPrompt: string;
  aspectRatio: string;
  status: MediaSceneStatus;
  now: string;
}, audit: MediaAuditWriter): MediaScene {
  getActiveMediaProjectOrThrow(db, projectId);
  const existing = getMediaSceneOrThrow(db, projectId, sceneId);
  const promptChanged = existing.title !== input.title || existing.dialogue !== input.dialogue || existing.visualPrompt !== input.visualPrompt || existing.aspectRatio !== input.aspectRatio || existing.durationSeconds !== input.durationSeconds;
  db.prepare(`UPDATE media_scenes SET title=?,description=?,duration_seconds=?,dialogue=?,visual_prompt=?,aspect_ratio=?,status=?,approved_at=?,updated_at=? WHERE id=? AND media_project_id=?`)
    .run(input.title, input.visualPrompt, input.durationSeconds, input.dialogue, input.visualPrompt, input.aspectRatio, input.status, input.status === "APPROVED" ? (existing.approvedAt ?? input.now) : null, input.now, sceneId, projectId);
  audit("MEDIA_SCENE_UPDATED", `Scene ${input.title} updated`, { projectId, payload: { sceneId, status: input.status } });
  if (promptChanged) {
    audit("MEDIA_FLOW_PROMPT_UPDATED", `Flow prompt updated for scene ${input.title}`, { projectId, payload: { sceneId, flowPrompt: buildGoogleFlowPrompt({ ...existing, ...input }, getPromptContext(db, projectId)) } });
  }
  return getMediaSceneOrThrow(db, projectId, sceneId);
}

export function approveMediaScene(db: Database.Database, projectId: string, sceneId: string, timestamp: string, audit: MediaAuditWriter): MediaScene {
  getActiveMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  db.prepare("UPDATE media_scenes SET status='APPROVED',approved_at=?,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, timestamp, sceneId, projectId);
  audit("MEDIA_SCENE_APPROVED", `Scene ${scene.title} approved`, { projectId, payload: { sceneId, timestamp } });
  return getMediaSceneOrThrow(db, projectId, sceneId);
}

export function rejectMediaScene(db: Database.Database, projectId: string, sceneId: string, timestamp: string, audit: MediaAuditWriter): MediaScene {
  getActiveMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  db.prepare("UPDATE media_scenes SET status='REJECTED',approved_at=NULL,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, sceneId, projectId);
  audit("MEDIA_SCENE_REJECTED", `Scene ${scene.title} rejected`, { projectId, payload: { sceneId, timestamp } });
  return getMediaSceneOrThrow(db, projectId, sceneId);
}

export function getSceneFlowPrompt(db: Database.Database, projectId: string, sceneId: string): { sceneId: string; prompt: string } {
  getMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  return { sceneId, prompt: buildGoogleFlowPrompt(scene, getPromptContext(db, projectId)) };
}

export function getSceneProviderPrompt(db: Database.Database, projectId: string, sceneId: string): string {
  getMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  return buildGoogleFlowPrompt(scene, getPromptContext(db, projectId));
}

export function reorderMediaScenes(db: Database.Database, projectId: string, sceneIds: string[], timestamp: string, audit: MediaAuditWriter): MediaScene[] {
  getActiveMediaProjectOrThrow(db, projectId);
  const scenes = listMediaScenes(db, projectId);
  const existing = new Set(scenes.map((scene) => scene.id));
  if (sceneIds.length !== scenes.length || sceneIds.some((sceneId) => !existing.has(sceneId)) || new Set(sceneIds).size !== sceneIds.length) {
    throw new MediaStudioError("Scene reorder must include each scene exactly once", 400);
  }
  const update = db.prepare("UPDATE media_scenes SET position=?,updated_at=? WHERE id=? AND media_project_id=?");
  for (const [index, sceneId] of sceneIds.entries()) {
    update.run(index + 1, timestamp, sceneId, projectId);
  }
  audit("MEDIA_SCENES_REORDERED", "Media scenes reordered", { projectId, payload: { sceneIds, timestamp } });
  return listMediaScenes(db, projectId);
}

export function importSceneAsset(db: Database.Database, projectId: string, sceneId: string, input: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  label?: string;
  now: string;
}, audit: MediaAuditWriter): MediaAsset {
  getActiveMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind) throw new MediaStudioError("Only allowed image, video, and audio assets can be imported", 400);
  const metadata = { importedVia: "manual-upload", sceneId, originalStatus: scene.status };
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,mime_type,size_bytes,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, sceneId, kind, input.label ?? input.fileName, "user-import", "IMPORTED", input.fileName, input.mimeType, input.sizeBytes, JSON.stringify(metadata), input.now, input.now);
  db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
  audit("MEDIA_SCENE_ASSET_IMPORTED", `Asset ${input.fileName} imported for scene ${scene.title}`, {
    projectId,
    payload: { sceneId, assetId: input.id, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes }
  });
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE id=?`).get(input.id) as MediaAsset;
}

export async function uploadSceneAsset(db: Database.Database, projectId: string, sceneId: string, input: {
  id: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  storageRoot?: string;
}, audit: MediaAuditWriter): Promise<MediaAsset> {
  getActiveMediaProjectOrThrow(db, projectId);
  const scene = getMediaSceneOrThrow(db, projectId, sceneId);
  validateAssetUpload(input.originalName, input.mimeType, input.bytes.length);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind) throw new MediaStudioError("Only allowed image, video, and audio assets can be uploaded", 400);
  const storageRoot = resolveStorageRoot(input.storageRoot);
  const safeName = safeAssetFileName(input.id, input.originalName, input.mimeType);
  const localPath = resolveAssetPath(storageRoot, projectId, sceneId, safeName);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes, { flag: "wx" });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const metadata = kind === "audio" ? normalizeAudioMetadata({ uploadedVia: "multipart", sceneId, originalStatus: scene.status, audioRole: "NARRATION" }) : { uploadedVia: "multipart", sceneId, originalStatus: scene.status };
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, sceneId, kind, input.originalName, "local-upload", "UPLOADED", safeName, input.originalName, input.mimeType, input.bytes.length, checksum, localPath, JSON.stringify(metadata), input.now, input.now);
  db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
  audit("MEDIA_SCENE_ASSET_UPLOADED", `Asset ${input.originalName} uploaded for scene ${scene.title}`, {
    projectId,
    payload: { sceneId, assetId: input.id, originalName: input.originalName, mimeType: input.mimeType, sizeBytes: input.bytes.length, checksumSha256: checksum, localPath }
  });
  return getMediaAssetOrThrow(db, projectId, input.id);
}

export async function uploadProjectAsset(db: Database.Database, projectId: string, input: {
  id: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  audioRole?: MediaAudioRole;
  storageRoot?: string;
}, audit: MediaAuditWriter): Promise<MediaAsset> {
  getActiveMediaProjectOrThrow(db, projectId);
  validateAssetUpload(input.originalName, input.mimeType, input.bytes.length);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind) throw new MediaStudioError("Only allowed image, video, and audio assets can be uploaded", 400);
  const storageRoot = resolveStorageRoot(input.storageRoot);
  const safeName = safeAssetFileName(input.id, input.originalName, input.mimeType);
  const localPath = resolveAssetPath(storageRoot, projectId, "project", safeName);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes, { flag: "wx" });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const metadata = kind === "audio" ? normalizeAudioMetadata({ audioRole: input.audioRole ?? "MUSIC" }) : { uploadedVia: "project-upload" };
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, null, kind, input.originalName, "local-upload", "UPLOADED", safeName, input.originalName, input.mimeType, input.bytes.length, checksum, localPath, JSON.stringify(metadata), input.now, input.now);
  audit("MEDIA_PROJECT_ASSET_UPLOADED", `Project asset ${input.originalName} uploaded`, {
    projectId,
    payload: { assetId: input.id, originalName: input.originalName, mimeType: input.mimeType, sizeBytes: input.bytes.length, checksumSha256: checksum, audioRole: input.audioRole ?? null }
  });
  return getMediaAssetOrThrow(db, projectId, input.id);
}

export async function uploadLibraryAsset(db: Database.Database, projectId: string, input: {
  id: string;
  ownerType: MediaLibraryAssetOwner;
  ownerId: string;
  role: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  storageRoot?: string;
}, audit: MediaAuditWriter): Promise<MediaAsset> {
  getActiveMediaProjectOrThrow(db, projectId);
  if (input.ownerType === "brand") getBrandKitOrThrow(db, projectId, input.ownerId);
  else getPresenterProfileOrThrow(db, projectId, input.ownerId);
  validateAssetUpload(input.originalName, input.mimeType, input.bytes.length);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind || kind !== "image") throw new MediaStudioError("Brand and presenter library assets must be images", 400);
  const storageRoot = resolveStorageRoot(input.storageRoot);
  const safeName = safeAssetFileName(input.id, input.originalName, input.mimeType);
  const localPath = resolveAssetPath(storageRoot, projectId, `${input.ownerType}-${input.ownerId}`, safeName);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes, { flag: "wx" });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const metadata = { libraryType: input.ownerType, ownerId: input.ownerId, role: input.role };
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, null, kind, input.originalName, `${input.ownerType}-library`, "UPLOADED", safeName, input.originalName, input.mimeType, input.bytes.length, checksum, localPath, JSON.stringify(metadata), input.now, input.now);
  audit(input.ownerType === "brand" ? "MEDIA_BRAND_ASSET_UPLOADED" : "MEDIA_PRESENTER_ASSET_UPLOADED", `${input.ownerType} asset ${input.originalName} uploaded`, {
    projectId,
    payload: { assetId: input.id, ownerType: input.ownerType, ownerId: input.ownerId, role: input.role, checksumSha256: checksum }
  });
  auditPromptContextChanged(db, projectId, input.now, audit);
  return getMediaAssetOrThrow(db, projectId, input.id);
}

export async function replaceLibraryAsset(db: Database.Database, projectId: string, assetId: string, input: {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  storageRoot?: string;
}, audit: MediaAuditWriter): Promise<MediaAsset> {
  getActiveMediaProjectOrThrow(db, projectId);
  const existing = getMediaAssetOrThrow(db, projectId, assetId);
  const metadata = parseMetadata(existing.metadataJson);
  const ownerType = metadata.libraryType === "brand" || metadata.libraryType === "presenter" ? metadata.libraryType : null;
  if (!ownerType) throw new MediaStudioError("Asset is not a brand or presenter library asset", 400);
  validateAssetUpload(input.originalName, input.mimeType, input.bytes.length);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind || kind !== "image") throw new MediaStudioError("Brand and presenter library assets must be images", 400);
  const storageRoot = resolveStorageRoot(input.storageRoot);
  if (existing.localPath) await removeStoredAssetFile(existing.localPath, storageRoot);
  if (existing.previewPath) await removeStoredAssetFile(existing.previewPath, storageRoot);
  if (existing.thumbnailPath) await removeStoredAssetFile(existing.thumbnailPath, storageRoot);
  const safeName = safeAssetFileName(assetId, input.originalName, input.mimeType);
  const localPath = resolveAssetPath(storageRoot, projectId, `${ownerType}-${String(metadata.ownerId ?? "library")}`, safeName);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes, { flag: "wx" });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  db.prepare(`UPDATE media_assets SET label=?,file_name=?,original_name=?,mime_type=?,size_bytes=?,checksum_sha256=?,local_path=?,inspection_json=NULL,qc_status='PENDING',qc_issues_json='[]',preview_path=NULL,thumbnail_path=NULL,updated_at=? WHERE id=? AND media_project_id=?`)
    .run(input.originalName, safeName, input.originalName, input.mimeType, input.bytes.length, checksum, localPath, input.now, assetId, projectId);
  audit(ownerType === "brand" ? "MEDIA_BRAND_ASSET_REPLACED" : "MEDIA_PRESENTER_ASSET_REPLACED", `${ownerType} asset replaced`, { projectId, payload: { assetId, checksumSha256: checksum } });
  auditPromptContextChanged(db, projectId, input.now, audit);
  return getMediaAssetOrThrow(db, projectId, assetId);
}

export async function deleteLibraryAsset(db: Database.Database, projectId: string, assetId: string, timestamp: string, audit: MediaAuditWriter, storageRoot?: string): Promise<{ deleted: true }> {
  getActiveMediaProjectOrThrow(db, projectId);
  const asset = getMediaAssetOrThrow(db, projectId, assetId);
  const metadata = parseMetadata(asset.metadataJson);
  const ownerType = metadata.libraryType === "brand" || metadata.libraryType === "presenter" ? metadata.libraryType : null;
  if (!ownerType) throw new MediaStudioError("Asset is not a brand or presenter library asset", 400);
  const root = resolveStorageRoot(storageRoot);
  if (asset.localPath) await removeStoredAssetFile(asset.localPath, root);
  if (asset.previewPath) await removeStoredAssetFile(asset.previewPath, root);
  if (asset.thumbnailPath) await removeStoredAssetFile(asset.thumbnailPath, root);
  db.prepare("DELETE FROM media_assets WHERE id=? AND media_project_id=?").run(assetId, projectId);
  audit(ownerType === "brand" ? "MEDIA_BRAND_ASSET_DELETED" : "MEDIA_PRESENTER_ASSET_DELETED", `${ownerType} asset deleted`, { projectId, payload: { assetId, metadata } });
  auditPromptContextChanged(db, projectId, timestamp, audit);
  return { deleted: true };
}

export function updateAudioAssetSettings(db: Database.Database, projectId: string, assetId: string, input: {
  role?: MediaAudioRole;
  volume?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  muted?: boolean;
  now: string;
}, audit: MediaAuditWriter): MediaAsset {
  getActiveMediaProjectOrThrow(db, projectId);
  const asset = getMediaAssetOrThrow(db, projectId, assetId);
  if (asset.kind !== "audio") throw new MediaStudioError("Audio settings can only be applied to audio assets", 400);
  const metadata = normalizeAudioMetadata({ ...parseMetadata(asset.metadataJson), ...input, audioRole: input.role ?? parseMetadata(asset.metadataJson).audioRole });
  if (metadata.trimEndSeconds !== null && metadata.trimEndSeconds < metadata.trimStartSeconds) {
    throw new MediaStudioError("Audio trim end must be after trim start", 400);
  }
  db.prepare("UPDATE media_assets SET metadata_json=?,updated_at=? WHERE id=? AND media_project_id=?").run(JSON.stringify(metadata), input.now, assetId, projectId);
  audit("MEDIA_AUDIO_SETTINGS_UPDATED", `Audio settings updated for ${asset.originalName ?? asset.label}`, { projectId, payload: { assetId, settings: metadata } });
  return getMediaAssetOrThrow(db, projectId, assetId);
}

export function selectProjectBackgroundMusic(db: Database.Database, projectId: string, assetId: string | null, timestamp: string, audit: MediaAuditWriter): { selectedAssetId: string | null } {
  getActiveMediaProjectOrThrow(db, projectId);
  if (assetId) {
    const asset = getMediaAssetOrThrow(db, projectId, assetId);
    if (asset.kind !== "audio") throw new MediaStudioError("Background music must be an audio asset", 400);
  }
  const assets = listMediaAssets(db, projectId).filter((asset) => asset.kind === "audio");
  for (const asset of assets) {
    const metadata = normalizeAudioMetadata({ ...parseMetadata(asset.metadataJson), backgroundMusic: asset.id === assetId, audioRole: asset.id === assetId ? "MUSIC" : parseMetadata(asset.metadataJson).audioRole });
    db.prepare("UPDATE media_assets SET metadata_json=?,updated_at=? WHERE id=? AND media_project_id=?").run(JSON.stringify(metadata), timestamp, asset.id, projectId);
  }
  audit("MEDIA_BACKGROUND_MUSIC_SELECTED", assetId ? "Project background music selected" : "Project background music cleared", { projectId, payload: { assetId } });
  return { selectedAssetId: assetId };
}

export async function replaceSceneAsset(db: Database.Database, projectId: string, sceneId: string, assetId: string, input: {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  storageRoot?: string;
}, audit: MediaAuditWriter): Promise<MediaAsset> {
  getActiveMediaProjectOrThrow(db, projectId);
  getMediaSceneOrThrow(db, projectId, sceneId);
  const existing = getMediaAssetOrThrow(db, projectId, assetId);
  if (existing.sceneId !== sceneId) throw new MediaStudioError("Media asset is not associated with this scene", 404);
  validateAssetUpload(input.originalName, input.mimeType, input.bytes.length);
  const kind = classifyAssetKind(input.mimeType);
  if (!kind) throw new MediaStudioError("Only allowed image, video, and audio assets can be uploaded", 400);
  const storageRoot = resolveStorageRoot(input.storageRoot);
  const safeName = safeAssetFileName(assetId, input.originalName, input.mimeType);
  const nextLocalPath = resolveAssetPath(storageRoot, projectId, sceneId, safeName);
  await fs.mkdir(path.dirname(nextLocalPath), { recursive: true });
  await fs.writeFile(nextLocalPath, input.bytes);
  if (existing.localPath && path.resolve(existing.localPath) !== path.resolve(nextLocalPath)) {
    await removeStoredAssetFile(existing.localPath, storageRoot);
  }
  if (existing.previewPath) await removeStoredAssetFile(existing.previewPath, storageRoot);
  if (existing.thumbnailPath) await removeStoredAssetFile(existing.thumbnailPath, storageRoot);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const metadata = kind === "audio" ? normalizeAudioMetadata({ ...parseMetadata(existing.metadataJson), uploadedVia: "multipart-replace", sceneId, replacedAssetId: assetId, previousChecksumSha256: existing.checksumSha256 }) : { uploadedVia: "multipart-replace", sceneId, replacedAssetId: assetId, previousChecksumSha256: existing.checksumSha256 };
  db.prepare(`UPDATE media_assets SET kind=?,label=?,source='local-upload',status='UPLOADED',file_name=?,original_name=?,mime_type=?,size_bytes=?,checksum_sha256=?,local_path=?,inspection_json=NULL,qc_status='PENDING',qc_issues_json='[]',preview_path=NULL,thumbnail_path=NULL,metadata_json=?,updated_at=? WHERE id=? AND media_project_id=?`)
    .run(kind, input.originalName, safeName, input.originalName, input.mimeType, input.bytes.length, checksum, nextLocalPath, JSON.stringify(metadata), input.now, assetId, projectId);
  db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
  audit("MEDIA_SCENE_ASSET_REPLACED", `Asset ${input.originalName} replaced`, {
    projectId,
    payload: { sceneId, assetId, originalName: input.originalName, mimeType: input.mimeType, sizeBytes: input.bytes.length, checksumSha256: checksum, localPath: nextLocalPath }
  });
  return getMediaAssetOrThrow(db, projectId, assetId);
}

export async function deleteSceneAsset(db: Database.Database, projectId: string, sceneId: string, assetId: string, timestamp: string, audit: MediaAuditWriter, storageRoot?: string): Promise<{ deleted: true }> {
  getActiveMediaProjectOrThrow(db, projectId);
  getMediaSceneOrThrow(db, projectId, sceneId);
  const asset = getMediaAssetOrThrow(db, projectId, assetId);
  if (asset.sceneId !== sceneId) throw new MediaStudioError("Media asset is not associated with this scene", 404);
  const root = resolveStorageRoot(storageRoot);
  if (asset.localPath) await removeStoredAssetFile(asset.localPath, root);
  if (asset.previewPath) await removeStoredAssetFile(asset.previewPath, root);
  if (asset.thumbnailPath) await removeStoredAssetFile(asset.thumbnailPath, root);
  db.prepare("DELETE FROM media_assets WHERE id=? AND media_project_id=?").run(assetId, projectId);
  audit("MEDIA_SCENE_ASSET_DELETED", `Asset ${asset.originalName ?? asset.label} deleted`, {
    projectId,
    payload: { sceneId, assetId, originalName: asset.originalName, localPath: asset.localPath, timestamp }
  });
  return { deleted: true };
}

export function getMediaAssetForDownload(db: Database.Database, projectId: string, assetId: string, storageRoot?: string): MediaAsset {
  getMediaProjectOrThrow(db, projectId);
  const asset = getMediaAssetOrThrow(db, projectId, assetId);
  if (!asset.localPath) throw new MediaStudioError("Media asset has no uploaded file", 404);
  assertAssetPathInsideRoot(asset.localPath, resolveStorageRoot(storageRoot));
  return asset;
}

export function exportMediaProductionPackage(db: Database.Database, projectId: string, exportedAt: string): MediaProductionPackage {
  const project = getMediaProjectOrThrow(db, projectId);
  const brief = getMediaBrief(db, projectId);
  const assets = listMediaAssets(db, projectId);
  const promptContext = getPromptContext(db, projectId);
  const scenes = listMediaScenes(db, projectId).map((scene) => ({
    ...scene,
    flowPrompt: buildGoogleFlowPrompt(scene, promptContext),
    assets: assets.filter((asset) => asset.sceneId === scene.id)
  }));
  return {
    exportedAt,
    project,
    brief: brief ? { ...brief, constraints: parseConstraints(brief.constraintsJson) } : null,
    scenes,
    assets,
    brandKits: listBrandKits(db, projectId),
    presenterProfiles: listPresenterProfiles(db, projectId)
  };
}

export function listMediaMessages(db: Database.Database, projectId: string): MediaChatMessage[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,sender,content,created_at AS createdAt
    FROM media_chat_messages WHERE media_project_id=? ORDER BY created_at`).all(projectId) as MediaChatMessage[];
}

export async function addDirectorChatMessage(db: Database.Database, input: {
  projectId: string;
  message: string;
  now: string;
  createId: IdFactory;
  replaceApproved?: boolean;
  regenerateSceneId?: string;
  directorProvider?: VideoDirectorProvider | null;
}, audit: MediaAuditWriter) {
  const project = getActiveMediaProjectOrThrow(db, input.projectId);
  const existingBrief = getMediaBrief(db, project.id);
  const existingScenes = listMediaScenes(db, project.id);
  if ((input.regenerateSceneId || existingBrief || existingScenes.length) && !input.replaceApproved) {
    throw new MediaStudioError("Replacing existing Video Director plan content requires approval", 403);
  }
  const userMessageId = input.createId();
  db.prepare("INSERT INTO media_chat_messages (id,media_project_id,sender,content,created_at) VALUES (?,?,?,?,?)")
    .run(userMessageId, project.id, "user", input.message, input.now);

  const messages = listMediaMessages(db, project.id);
  if (input.regenerateSceneId) {
    const scene = getMediaSceneOrThrow(db, project.id, input.regenerateSceneId);
    const result = await generateSceneWithFallback(project, existingBrief, scene, input.message, input.directorProvider ?? null);
    audit(result.jobResult.fallback ? "MEDIA_DIRECTOR_PROVIDER_FALLBACK" : "MEDIA_DIRECTOR_PROVIDER_COMPLETED", result.jobResult.fallback ? "Video Director scene provider failed; deterministic fallback used" : "Video Director scene provider completed", {
      projectId: project.id,
      payload: { sceneId: scene.id, provider: result.jobResult.provider, model: result.jobResult.model, usage: result.jobResult.usage, error: result.jobResult.error }
    });
    const updatedScene = replaceSceneFromDirector(db, project.id, scene.id, result.scene, input.now);
    insertDirectorGenerationJob(db, input.createId(), project.id, result.providerKey, "COMPLETED", {
      mode: "SCENE_REGENERATION",
      sceneId: scene.id,
      message: input.message
    }, result.jobResult, input.now);
    const response = formatSceneResponse(updatedScene, result.source);
    const directorMessageId = input.createId();
    db.prepare("INSERT INTO media_chat_messages (id,media_project_id,sender,content,created_at) VALUES (?,?,?,?,?)")
      .run(directorMessageId, project.id, "director", response, input.now);
    audit("MEDIA_DIRECTOR_SCENE_REGENERATED", `Scene regenerated for ${project.name}`, {
      projectId: project.id,
      payload: { sceneId: scene.id, userMessageId, directorMessageId, provider: result.jobResult.provider, model: result.jobResult.model, usage: result.jobResult.usage, fallback: result.jobResult.fallback }
    });
    return getMediaProjectBundle(db, project.id);
  }

  const result = await generatePlanWithFallback(project, input.message, messages.map((message) => message.content), getMediaProjectBundle(db, project.id), input.directorProvider ?? null);
  audit(result.jobResult.fallback ? "MEDIA_DIRECTOR_PROVIDER_FALLBACK" : "MEDIA_DIRECTOR_PROVIDER_COMPLETED", result.jobResult.fallback ? "Video Director provider failed; deterministic fallback used" : "Video Director provider completed", {
    projectId: project.id,
    payload: { provider: result.jobResult.provider, model: result.jobResult.model, usage: result.jobResult.usage, error: result.jobResult.error }
  });
  const draft = planToBriefDraft(result.plan);
  const brief = replaceBrief(db, project.id, draft, input.now, input.createId);
  insertDirectorGenerationJob(db, input.createId(), project.id, result.providerKey, "COMPLETED", {
    mode: "FULL_PLAN",
    message: input.message
  }, result.jobResult, input.now);
  const response = formatDirectorResponse(draft, result.source);
  const directorMessageId = input.createId();
  db.prepare("INSERT INTO media_chat_messages (id,media_project_id,sender,content,created_at) VALUES (?,?,?,?,?)")
    .run(directorMessageId, project.id, "director", response, input.now);
  audit("MEDIA_DIRECTOR_BRIEF_UPDATED", `Video brief updated for ${project.name}`, {
    projectId: project.id,
    payload: { briefId: brief.id, userMessageId, directorMessageId, sceneCount: draft.scenes.length, provider: result.jobResult.provider, model: result.jobResult.model, usage: result.jobResult.usage, fallback: result.jobResult.fallback }
  });
  return getMediaProjectBundle(db, project.id);
}

export function deleteMediaChatMessage(db: Database.Database, projectId: string, messageId: string, timestamp: string, audit: MediaAuditWriter) {
  getActiveMediaProjectOrThrow(db, projectId);
  const result = db.prepare("DELETE FROM media_chat_messages WHERE id=? AND media_project_id=?").run(messageId, projectId);
  if (result.changes === 0) throw new MediaStudioError("Media chat message not found", 404);
  audit("MEDIA_CHAT_MESSAGE_DELETED", "Media chat message deleted", { projectId, payload: { messageId, timestamp } });
  return { deleted: true };
}

function getMediaProjectOrThrow(db: Database.Database, projectId: string): MediaProject {
  const project = db.prepare("SELECT id,name,description,aspect_ratio AS aspectRatio,default_brand_kit_id AS defaultBrandKitId,default_presenter_profile_id AS defaultPresenterProfileId,status,created_at AS createdAt,updated_at AS updatedAt FROM media_projects WHERE id=?").get(projectId) as MediaProject | undefined;
  if (!project) throw new MediaStudioError("Media project not found", 404);
  return project;
}

function getActiveMediaProjectOrThrow(db: Database.Database, projectId: string): MediaProject {
  const project = getMediaProjectOrThrow(db, projectId);
  if (project.status !== "ACTIVE") throw new MediaStudioError("Media project is archived", 409);
  return project;
}

function getMediaBrief(db: Database.Database, projectId: string): MediaBrief | null {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,title,logline,audience,style,duration_seconds AS durationSeconds,
    constraints_json AS constraintsJson,status,approved_at AS approvedAt,created_at AS createdAt,updated_at AS updatedAt FROM media_video_briefs WHERE media_project_id=?`).get(projectId) as MediaBrief | undefined ?? null;
}

function listMediaScenes(db: Database.Database, projectId: string): MediaScene[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,brief_id AS briefId,position,title,description,duration_seconds AS durationSeconds,
    dialogue,visual_prompt AS visualPrompt,aspect_ratio AS aspectRatio,status,approved_at AS approvedAt,created_at AS createdAt,updated_at AS updatedAt FROM media_scenes WHERE media_project_id=? ORDER BY position`).all(projectId) as MediaScene[];
}

function listMediaAssets(db: Database.Database, projectId: string): MediaAsset[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE media_project_id=? ORDER BY created_at`).all(projectId) as MediaAsset[];
}

function listBrandKits(db: Database.Database, projectId: string): MediaBrandKit[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,name,colors_json AS colorsJson,fonts_json AS fontsJson,tagline,tone,disclaimer,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
    FROM media_brand_kits WHERE media_project_id=? AND deleted_at IS NULL ORDER BY created_at`).all(projectId) as MediaBrandKit[];
}

function listPresenterProfiles(db: Database.Database, projectId: string): MediaPresenterProfile[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,name,appearance_prompt AS appearancePrompt,voice_accent AS voiceAccent,clothing,consistency_rules AS consistencyRules,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
    FROM media_presenter_profiles WHERE media_project_id=? AND deleted_at IS NULL ORDER BY created_at`).all(projectId) as MediaPresenterProfile[];
}

function listGenerationJobs(db: Database.Database, projectId: string): MediaGenerationJob[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,
    created_at AS createdAt,updated_at AS updatedAt FROM media_generation_jobs WHERE media_project_id=? ORDER BY created_at`).all(projectId) as MediaGenerationJob[];
}

function replaceBrief(db: Database.Database, projectId: string, draft: BriefDraft, timestamp: string, createId: IdFactory): MediaBrief {
  const existing = getMediaBrief(db, projectId);
  const briefId = existing?.id ?? createId();
  if (existing) {
    db.prepare(`UPDATE media_video_briefs SET title=?,logline=?,audience=?,style=?,duration_seconds=?,constraints_json=?,status='DRAFT',approved_at=NULL,updated_at=? WHERE id=?`)
      .run(draft.title, draft.logline, draft.audience, draft.style, draft.durationSeconds, JSON.stringify(draft.constraints), timestamp, briefId);
  } else {
    db.prepare(`INSERT INTO media_video_briefs (id,media_project_id,title,logline,audience,style,duration_seconds,constraints_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(briefId, projectId, draft.title, draft.logline, draft.audience, draft.style, draft.durationSeconds, JSON.stringify(draft.constraints), "DRAFT", timestamp, timestamp);
  }
  db.prepare("DELETE FROM media_assets WHERE media_project_id=?").run(projectId);
  db.prepare("DELETE FROM media_scenes WHERE media_project_id=?").run(projectId);
  for (const [index, scene] of draft.scenes.entries()) {
    const sceneId = createId();
    db.prepare(`INSERT INTO media_scenes (id,media_project_id,brief_id,position,title,description,duration_seconds,dialogue,visual_prompt,aspect_ratio,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sceneId, projectId, briefId, index + 1, scene.title, scene.description, scene.durationSeconds, scene.dialogue ?? "", scene.visualPrompt ?? scene.description, scene.aspectRatio ?? "16:9", "DRAFT", timestamp, timestamp);
    db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(createId(), projectId, sceneId, "reference", scene.assetLabel, "chat-derived", "PLANNED", timestamp, timestamp);
  }
  db.prepare("DELETE FROM media_generation_jobs WHERE media_project_id=?").run(projectId);
  seedProviderJobs(db, projectId, timestamp, createId, { briefId, title: draft.title });
  return getMediaBrief(db, projectId) as MediaBrief;
}

function seedProviderJobs(db: Database.Database, projectId: string, timestamp: string, createId: IdFactory, request: Record<string, unknown> = {}) {
  for (const provider of mediaProviderRegistry) {
    db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(createId(), projectId, provider.key, "STUBBED", JSON.stringify({ providerKey: provider.key, mode: "not-implemented", ...request }), null, timestamp, timestamp);
  }
}

async function generatePlanWithFallback(project: MediaProject, userIdea: string, messages: string[], existingContext: unknown, provider: VideoDirectorProvider | null) {
  if (provider) {
    try {
      const result = await provider.generatePlan({ projectName: project.name, projectDescription: project.description, userIdea, existingContext });
      return {
        source: `${result.provider}:${result.model}`,
        providerKey: "nvidia-video-director",
        plan: result.value,
        jobResult: { provider: result.provider, model: result.model, usage: result.usage, fallback: false, plan: result.value }
      };
    } catch (error) {
      const fallbackPlan = deterministicPlan(project.name, messages);
      return {
        source: "deterministic fallback",
        providerKey: "nvidia-video-director",
        plan: fallbackPlan,
        jobResult: { provider: "nvidia", model: null, usage: null, fallback: true, error: sanitizeProviderError(error), plan: fallbackPlan }
      };
    }
  }
  const plan = deterministicPlan(project.name, messages);
  return {
    source: "deterministic generator",
    providerKey: "deterministic-video-director",
    plan,
    jobResult: { provider: "deterministic", model: null, usage: null, fallback: false, plan }
  };
}

async function generateSceneWithFallback(project: MediaProject, brief: MediaBrief | null, scene: MediaScene, userIdea: string, provider: VideoDirectorProvider | null) {
  if (provider) {
    try {
      const result = await provider.generateScene({ projectName: project.name, projectDescription: project.description, userIdea, existingBrief: brief, existingScene: scene });
      return {
        source: `${result.provider}:${result.model}`,
        providerKey: "nvidia-video-director",
        scene: result.value,
        jobResult: { provider: result.provider, model: result.model, usage: result.usage, fallback: false, scene: result.value }
      };
    } catch (error) {
      const fallbackScene = deterministicSceneFromMessage(scene, userIdea);
      return {
        source: "deterministic fallback",
        providerKey: "nvidia-video-director",
        scene: fallbackScene,
        jobResult: { provider: "nvidia", model: null, usage: null, fallback: true, error: sanitizeProviderError(error), scene: fallbackScene }
      };
    }
  }
  const fallbackScene = deterministicSceneFromMessage(scene, userIdea);
  return {
    source: "deterministic generator",
    providerKey: "deterministic-video-director",
    scene: fallbackScene,
    jobResult: { provider: "deterministic", model: null, usage: null, fallback: false, scene: fallbackScene }
  };
}

function planToBriefDraft(plan: VideoDirectorPlan): BriefDraft {
  return {
    title: plan.brief.title,
    logline: plan.brief.logline,
    audience: plan.brief.audience,
    style: plan.brief.style,
    durationSeconds: plan.brief.durationSeconds,
    constraints: plan.brief.constraints,
    script: plan.script,
    scenes: plan.scenes
  };
}

function deterministicPlan(projectName: string, messages: string[]): VideoDirectorPlan {
  const draft = generateDeterministicBrief(projectName, messages);
  return {
    brief: {
      title: draft.title,
      logline: draft.logline,
      audience: draft.audience,
      style: draft.style,
      durationSeconds: draft.durationSeconds,
      constraints: draft.constraints
    },
    script: draft.scenes.map((scene) => `${scene.title}: ${scene.description}`).join("\n"),
    scenes: draft.scenes.map((scene) => ({
      title: scene.title,
      description: scene.description,
      durationSeconds: scene.durationSeconds,
      dialogue: scene.dialogue ?? "",
      visualPrompt: scene.visualPrompt ?? scene.description,
      aspectRatio: (scene.aspectRatio ?? "16:9") as VideoDirectorScene["aspectRatio"],
      assetLabel: scene.assetLabel
    }))
  };
}

function deterministicSceneFromMessage(existing: MediaScene, message: string): VideoDirectorScene {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const prompt = cleaned || existing.visualPrompt || existing.description;
  return {
    title: existing.title,
    description: prompt,
    durationSeconds: existing.durationSeconds,
    dialogue: existing.dialogue,
    visualPrompt: prompt,
    aspectRatio: existing.aspectRatio as VideoDirectorScene["aspectRatio"],
    assetLabel: `${existing.title} regenerated reference`
  };
}

function replaceSceneFromDirector(db: Database.Database, projectId: string, sceneId: string, scene: VideoDirectorScene, timestamp: string): MediaScene {
  db.prepare(`UPDATE media_scenes SET title=?,description=?,duration_seconds=?,dialogue=?,visual_prompt=?,aspect_ratio=?,status='DRAFT',approved_at=NULL,updated_at=? WHERE id=? AND media_project_id=?`)
    .run(scene.title, scene.description, scene.durationSeconds, scene.dialogue, scene.visualPrompt, scene.aspectRatio, timestamp, sceneId, projectId);
  return getMediaSceneOrThrow(db, projectId, sceneId);
}

function insertDirectorGenerationJob(db: Database.Database, id: string, projectId: string, providerKey: string, status: string, request: unknown, result: unknown, timestamp: string) {
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, providerKey, status, JSON.stringify(request), JSON.stringify(result), timestamp, timestamp);
}

function generateDeterministicBrief(projectName: string, messages: string[]): BriefDraft {
  const combined = messages.join(" ").replace(/\s+/g, " ").trim();
  const source = combined || projectName;
  const sentence = source.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? projectName;
  const words = sentence.split(/\s+/).filter(Boolean);
  const title = titleCase(words.slice(0, 8).join(" ") || projectName);
  const lower = source.toLowerCase();
  const style = lower.includes("cinematic") ? "Cinematic" : lower.includes("product") ? "Product demo" : lower.includes("education") || lower.includes("explain") ? "Educational" : "Documentary";
  const audience = lower.includes("investor") ? "Investors" : lower.includes("customer") ? "Customers" : lower.includes("team") ? "Internal team" : "General audience";
  const durationSeconds = lower.includes("short") ? 30 : lower.includes("minute") ? 60 : 45;
  const logline = `A ${durationSeconds}-second ${style.toLowerCase()} video for ${audience.toLowerCase()} about ${sentence}.`;
  return {
    title,
    logline,
    audience,
    style,
    durationSeconds,
    constraints: ["No external AI calls", "No rendering", "Provider jobs remain stubbed"],
    scenes: [
      { title: "Hook", description: `Open with the clearest promise from: ${sentence}.`, durationSeconds: Math.round(durationSeconds * 0.25), assetLabel: "Opening visual reference" },
      { title: "Proof", description: `Show the concrete context and supporting details from the chat brief.`, durationSeconds: Math.round(durationSeconds * 0.5), assetLabel: "Supporting b-roll or product capture" },
      { title: "Close", description: `End with the next action or takeaway for ${audience.toLowerCase()}.`, durationSeconds: durationSeconds - Math.round(durationSeconds * 0.25) - Math.round(durationSeconds * 0.5), assetLabel: "Closing title card" }
    ]
  };
}

function formatDirectorResponse(draft: BriefDraft, source = "deterministic generator") {
  return [
    `Draft brief: ${draft.title}`,
    `Source: ${source}`,
    draft.logline,
    draft.script ? `\nScript:\n${draft.script}` : "",
    "",
    "Scenes:",
    ...draft.scenes.map((scene, index) => `${index + 1}. ${scene.title} - ${scene.description}`)
  ].filter((line) => line !== "").join("\n");
}

function formatSceneResponse(scene: MediaScene, source = "deterministic generator") {
  return [
    `Regenerated scene: ${scene.title}`,
    `Source: ${source}`,
    scene.description,
    "",
    "Prompt:",
    scene.visualPrompt,
    "",
    "Dialogue:",
    scene.dialogue || "No spoken dialogue."
  ].join("\n");
}

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function getMediaSceneOrThrow(db: Database.Database, projectId: string, sceneId: string): MediaScene {
  const scene = db.prepare(`SELECT id,media_project_id AS mediaProjectId,brief_id AS briefId,position,title,description,duration_seconds AS durationSeconds,
    dialogue,visual_prompt AS visualPrompt,aspect_ratio AS aspectRatio,status,approved_at AS approvedAt,created_at AS createdAt,updated_at AS updatedAt
    FROM media_scenes WHERE id=? AND media_project_id=?`).get(sceneId, projectId) as MediaScene | undefined;
  if (!scene) throw new MediaStudioError("Media scene not found", 404);
  return scene;
}

function getMediaAssetOrThrow(db: Database.Database, projectId: string, assetId: string): MediaAsset {
  const asset = db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE id=? AND media_project_id=?`).get(assetId, projectId) as MediaAsset | undefined;
  if (!asset) throw new MediaStudioError("Media asset not found", 404);
  return asset;
}

function getBrandKitOrThrow(db: Database.Database, projectId: string, brandKitId: string): MediaBrandKit {
  const kit = db.prepare(`SELECT id,media_project_id AS mediaProjectId,name,colors_json AS colorsJson,fonts_json AS fontsJson,tagline,tone,disclaimer,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
    FROM media_brand_kits WHERE id=? AND media_project_id=? AND deleted_at IS NULL`).get(brandKitId, projectId) as MediaBrandKit | undefined;
  if (!kit) throw new MediaStudioError("Brand kit not found", 404);
  return kit;
}

function getPresenterProfileOrThrow(db: Database.Database, projectId: string, presenterProfileId: string): MediaPresenterProfile {
  const profile = db.prepare(`SELECT id,media_project_id AS mediaProjectId,name,appearance_prompt AS appearancePrompt,voice_accent AS voiceAccent,clothing,consistency_rules AS consistencyRules,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
    FROM media_presenter_profiles WHERE id=? AND media_project_id=? AND deleted_at IS NULL`).get(presenterProfileId, projectId) as MediaPresenterProfile | undefined;
  if (!profile) throw new MediaStudioError("Presenter profile not found", 404);
  return profile;
}

type PromptContext = { brand: MediaBrandKit | null; presenter: MediaPresenterProfile | null };

function getPromptContext(db: Database.Database, projectId: string): PromptContext {
  const project = getMediaProjectOrThrow(db, projectId);
  return {
    brand: project.defaultBrandKitId ? getBrandKitOrThrow(db, projectId, project.defaultBrandKitId) : null,
    presenter: project.defaultPresenterProfileId ? getPresenterProfileOrThrow(db, projectId, project.defaultPresenterProfileId) : null
  };
}

function buildPromptContextLines(context?: PromptContext): string[] {
  const lines: string[] = [];
  if (context?.brand) {
    const colors = parseStringList(context.brand.colorsJson);
    const fonts = parseStringList(context.brand.fontsJson);
    lines.push("Brand rules:", `Brand: ${context.brand.name}`);
    if (context.brand.tagline) lines.push(`Tagline: ${context.brand.tagline}`);
    if (colors.length) lines.push(`Colours: ${colors.join(", ")}`);
    if (fonts.length) lines.push(`Fonts: ${fonts.join(", ")}`);
    if (context.brand.tone) lines.push(`Tone: ${context.brand.tone}`);
    if (context.brand.disclaimer) lines.push(`Disclaimer text to preserve: ${context.brand.disclaimer}`);
    lines.push("");
  }
  if (context?.presenter) {
    lines.push("Presenter consistency rules:", `Presenter: ${context.presenter.name}`);
    if (context.presenter.appearancePrompt) lines.push(`Appearance: ${context.presenter.appearancePrompt}`);
    if (context.presenter.voiceAccent) lines.push(`Voice/accent: ${context.presenter.voiceAccent}`);
    if (context.presenter.clothing) lines.push(`Clothing: ${context.presenter.clothing}`);
    if (context.presenter.consistencyRules) lines.push(`Consistency: ${context.presenter.consistencyRules}`);
    lines.push("");
  }
  return lines;
}

function auditPromptContextChanged(db: Database.Database, projectId: string, timestamp: string, audit: MediaAuditWriter) {
  const scenes = listMediaScenes(db, projectId);
  const context = getPromptContext(db, projectId);
  for (const scene of scenes) {
    audit("MEDIA_FLOW_PROMPT_UPDATED", `Flow prompt updated for scene ${scene.title}`, { projectId, payload: { sceneId: scene.id, timestamp, flowPrompt: buildGoogleFlowPrompt(scene, context) } });
  }
}

function buildGoogleFlowPrompt(scene: Pick<MediaScene, "title" | "durationSeconds" | "dialogue" | "visualPrompt" | "aspectRatio">, context?: PromptContext): string {
  return [
    `Scene: ${scene.title}`,
    `Duration: ${scene.durationSeconds} seconds`,
    `Aspect ratio: ${scene.aspectRatio}`,
    "",
    ...buildPromptContextLines(context),
    "Visual prompt:",
    scene.visualPrompt.trim(),
    "",
    "Dialogue:",
    scene.dialogue.trim() || "No spoken dialogue.",
    "",
    "Output guidance:",
    "Generate a coherent single-scene video clip. Preserve the visual prompt, timing, dialogue, brand rules, and presenter consistency exactly. Do not add extra text unless explicitly requested."
  ].join("\n");
}

function parseStringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function classifyAssetKind(mimeType: string): "image" | "video" | "audio" | null {
  if (!mediaAssetMimeTypes.has(mimeType)) return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

function validateAssetUpload(originalName: string, mimeType: string, sizeBytes: number): void {
  if (originalName !== path.basename(originalName) || originalName.includes("/") || originalName.includes("\\")) {
    throw new MediaStudioError("Asset filename must not include a path", 400);
  }
  if (!mediaAssetMimeTypes.has(mimeType)) {
    throw new MediaStudioError("Only allowed image, video, and audio MIME types can be uploaded", 400);
  }
  if (sizeBytes < 1) throw new MediaStudioError("Uploaded asset is empty", 400);
  if (sizeBytes > mediaAssetMaxBytes) throw new MediaStudioError("Uploaded asset exceeds the size limit", 413);
}

function resolveStorageRoot(storageRoot?: string): string {
  return path.resolve(storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
}

function resolveAssetPath(storageRoot: string, projectId: string, sceneId: string, fileName: string): string {
  const resolved = path.resolve(storageRoot, sanitizePathSegment(projectId), sanitizePathSegment(sceneId), fileName);
  assertAssetPathInsideRoot(resolved, storageRoot);
  return resolved;
}

function assertAssetPathInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new MediaStudioError("Media asset path escapes storage root", 400);
  }
}

function safeAssetFileName(assetId: string, originalName: string, mimeType: string): string {
  const extension = extensionForMimeType(mimeType) ?? path.extname(originalName).toLowerCase();
  const stem = path.basename(originalName, path.extname(originalName)).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "asset";
  return `${sanitizePathSegment(assetId)}-${stem}${extension}`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function extensionForMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "video/mp4": return ".mp4";
    case "video/webm": return ".webm";
    case "video/quicktime": return ".mov";
    case "audio/mpeg": return ".mp3";
    case "audio/mp4": return ".m4a";
    case "audio/aac": return ".aac";
    case "audio/wav":
    case "audio/x-wav": return ".wav";
    default: return null;
  }
}

async function removeStoredAssetFile(localPath: string, storageRoot: string): Promise<void> {
  assertAssetPathInsideRoot(localPath, storageRoot);
  try {
    await fs.unlink(localPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function parseConstraints(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeAudioMetadata(input: Record<string, unknown>) {
  const role = input.audioRole === "MUSIC" || input.audioRole === "SFX" || input.audioRole === "SCENE_AUDIO" || input.audioRole === "NARRATION" ? input.audioRole : "NARRATION";
  return {
    ...input,
    audioRole: role,
    volume: clampNumber(input.volume, role === "MUSIC" ? 0.25 : 1, 0, 2),
    trimStartSeconds: clampNumber(input.trimStartSeconds, 0, 0, 24 * 60 * 60),
    trimEndSeconds: typeof input.trimEndSeconds === "number" && Number.isFinite(input.trimEndSeconds) ? Math.max(0, input.trimEndSeconds) : null,
    fadeInSeconds: clampNumber(input.fadeInSeconds, 0, 0, 60),
    fadeOutSeconds: clampNumber(input.fadeOutSeconds, 0, 0, 60),
    muted: Boolean(input.muted),
    backgroundMusic: Boolean(input.backgroundMusic)
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
