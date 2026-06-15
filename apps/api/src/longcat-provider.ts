import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { processMediaAsset, type MediaProcessingOptions } from "./media-processing.js";
import { recordGenerationStatusHistory } from "./media-generation-history.js";

export type LongCatJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type LongCatHttp = typeof fetch;

export type LongCatConfig = {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
};

export function loadLongCatConfig(env: NodeJS.ProcessEnv = process.env): LongCatConfig {
  return {
    enabled: (env.LONGCAT_ENABLED ?? "false").toLowerCase() === "true",
    baseUrl: env.LONGCAT_BASE_URL ?? "http://127.0.0.1:8291",
    timeoutMs: Number(env.LONGCAT_TIMEOUT_MS ?? 120_000)
  };
}

export function longCatStatusResponse(config: LongCatConfig) {
  return {
    enabled: config.enabled,
    baseUrlHostname: safeHostname(config.baseUrl),
    timeoutMs: config.timeoutMs
  };
}

export async function testLongCatConnection(config: LongCatConfig = loadLongCatConfig(), fetchImpl: LongCatHttp = fetch) {
  if (!config.enabled) return { status: "disabled", ...longCatStatusResponse(config), lastTestedAt: new Date().toISOString() };
  try {
    const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/health`, { method: "GET" }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`LongCat health check failed: ${response.status}`);
    return { status: "ok", ...longCatStatusResponse(config), lastTestedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "error", ...longCatStatusResponse(config), lastTestedAt: new Date().toISOString(), sanitizedError: sanitizeLog(error instanceof Error ? error.message : String(error)) };
  }
}

export async function generateLongCatPresenter(db: Database.Database, projectId: string, sceneId: string, input: {
  jobId: string;
  outputAssetId: string;
  now: string;
  approved: boolean;
  config?: LongCatConfig;
  fetchImpl?: LongCatHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  if (!input.approved) throw new MediaStudioError("LongCat generation requires explicit approval", 403);
  const config = input.config ?? loadLongCatConfig();
  if (!config.enabled) throw new MediaStudioError("LongCat provider is disabled", 409);
  const scene = getScene(db, projectId, sceneId);
  const image = getSceneAsset(db, projectId, sceneId, "image");
  const audio = getSceneAsset(db, projectId, sceneId, "audio");
  const fetchImpl = input.fetchImpl ?? fetch;
  const storageRoot = resolveStorageRoot(input.storageRoot);

  insertGenerationJob(db, input.jobId, projectId, "longcat-avatar", "QUEUED", { sceneId, mode: "PRESENTER", prompt: scene.visualPrompt }, input.now);
  updateGenerationJob(db, input.jobId, "RUNNING", input.now, "Starting LongCat presenter generation");
  audit("MEDIA_LONGCAT_GENERATION_STARTED", `LongCat generation started for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId } });

  try {
    const remoteJobId = await submitLongCatJob(config, { scene, image, audio }, fetchImpl);
    updateGenerationJob(db, input.jobId, "RUNNING", input.now, `Submitted LongCat job ${remoteJobId}`, { remoteJobId }, "submitted");
    const output = await pollLongCatOutput(config, remoteJobId, fetchImpl, (status, progress) => {
      recordGenerationStatusHistory(db, { generationJobId: input.jobId, status: "RUNNING", createdAt: input.now, progressPercent: progress, message: "LongCat generation update", providerStatus: status });
    });
    const bytes = await downloadLongCatOutput(config, remoteJobId, output, fetchImpl);
    const asset = await saveLongCatVideoAsset(db, projectId, sceneId, {
      id: input.outputAssetId,
      originalName: output.filename ?? "longcat-output.mp4",
      bytes,
      now: input.now,
      storageRoot,
      metadata: { remoteJobId, provider: "longcat-avatar" }
    });
    updateGenerationJob(db, input.jobId, "COMPLETED", input.now, `Generated ${asset.originalName ?? asset.fileName ?? "LongCat presenter"}`, { remoteJobId, output, assetId: asset.id });
    db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
    audit("MEDIA_LONGCAT_GENERATION_COMPLETED", `LongCat generation completed for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId, assetId: asset.id } });
    await processMediaAsset(db, projectId, asset.id, { jobId: `${input.jobId}-qc`, now: input.now, storageRoot, ...input.processOptions }, audit);
    return { job: getGenerationJob(db, input.jobId), asset: getAsset(db, projectId, asset.id) };
  } catch (error) {
    const message = sanitizeLog(error instanceof Error ? error.message : String(error));
    updateGenerationJob(db, input.jobId, "FAILED", input.now, message);
    audit("MEDIA_LONGCAT_GENERATION_FAILED", message, { projectId, payload: { sceneId, jobId: input.jobId } });
    throw new MediaStudioError(message, 502);
  }
}

export async function cancelLongCatGeneration(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter, config: LongCatConfig = loadLongCatConfig(), fetchImpl: LongCatHttp = fetch) {
  const job = getGenerationJob(db, jobId);
  if (job.mediaProjectId !== projectId) throw new MediaStudioError("Generation job not found", 404);
  const remoteJobId = parseRemoteJobId(job.resultJson);
  if (remoteJobId && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && config.enabled) {
    await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/jobs/${encodeURIComponent(remoteJobId)}/cancel`, { method: "POST" }, config.timeoutMs, fetchImpl).catch(() => undefined);
  }
  updateGenerationJob(db, jobId, "CANCELLED", timestamp, "LongCat generation cancelled", remoteJobId ? { remoteJobId } : null);
  audit("MEDIA_LONGCAT_GENERATION_CANCELLED", "LongCat generation cancelled", { projectId, payload: { jobId, remoteJobId } });
  return getGenerationJob(db, jobId);
}

export async function retryLongCatGeneration(db: Database.Database, projectId: string, jobId: string, input: {
  jobId: string;
  outputAssetId: string;
  now: string;
  approved: boolean;
  config?: LongCatConfig;
  fetchImpl?: LongCatHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  const previous = getGenerationJob(db, jobId);
  recordGenerationStatusHistory(db, { generationJobId: jobId, status: "RETRIED", createdAt: input.now, message: `Retry requested as ${input.jobId}` });
  const request = JSON.parse(previous.requestJson) as { sceneId: string };
  return generateLongCatPresenter(db, projectId, request.sceneId, input, audit);
}

async function submitLongCatJob(config: LongCatConfig, input: { scene: SceneRow; image: AssetRow; audio: AssetRow }, fetchImpl: LongCatHttp) {
  const form = new FormData();
  const imageBytes = await fs.readFile(input.image.localPath);
  const audioBytes = await fs.readFile(input.audio.localPath);
  form.append("image", new Blob([new Uint8Array(imageBytes)], { type: input.image.mimeType ?? "image/png" }), input.image.fileName ?? input.image.originalName ?? "input.png");
  form.append("audio", new Blob([new Uint8Array(audioBytes)], { type: input.audio.mimeType ?? "audio/wav" }), input.audio.fileName ?? input.audio.originalName ?? "input.wav");
  form.append("prompt", input.scene.visualPrompt);
  form.append("dialogue", input.scene.dialogue);
  form.append("scene_title", input.scene.title);
  const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/jobs`, { method: "POST", body: form }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`LongCat submit failed: ${response.status}`);
  const data = await response.json() as { job_id?: string; id?: string };
  const jobId = data.job_id ?? data.id;
  if (!jobId) throw new Error("LongCat did not return a job id");
  return jobId;
}

async function pollLongCatOutput(config: LongCatConfig, remoteJobId: string, fetchImpl: LongCatHttp, onStatus?: (status: string, progress?: number) => void) {
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() <= deadline) {
    const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/jobs/${encodeURIComponent(remoteJobId)}`, { method: "GET" }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`LongCat poll failed: ${response.status}`);
    const data = await response.json() as LongCatPollResponse;
    const status = (data.status ?? "").toLowerCase();
    onStatus?.(status || "unknown", typeof data.progress === "number" ? data.progress : undefined);
    if (["failed", "error"].includes(status)) throw new Error(data.error ?? "LongCat job failed");
    if (["cancelled", "canceled"].includes(status)) throw new Error("LongCat job was cancelled");
    if (["completed", "succeeded", "success"].includes(status)) {
      return { filename: data.output?.filename ?? data.filename ?? "longcat-output.mp4", url: data.output?.url ?? data.output_url };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("LongCat generation timed out");
}

async function downloadLongCatOutput(config: LongCatConfig, remoteJobId: string, output: { filename?: string; url?: string }, fetchImpl: LongCatHttp) {
  const url = output.url ? new URL(output.url, trimBaseUrl(config.baseUrl)).toString() : `${trimBaseUrl(config.baseUrl)}/jobs/${encodeURIComponent(remoteJobId)}/output`;
  const response = await fetchWithTimeout(url, { method: "GET" }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`LongCat output download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function saveLongCatVideoAsset(db: Database.Database, projectId: string, sceneId: string, input: { id: string; originalName: string; bytes: Buffer; now: string; storageRoot: string; metadata: unknown }) {
  const fileName = `${sanitizeSegment(input.id)}-longcat.mp4`;
  const localPath = path.resolve(input.storageRoot, sanitizeSegment(projectId), sanitizeSegment(sceneId), fileName);
  assertInsideRoot(localPath, input.storageRoot);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, sceneId, "video", `LongCat generated ${input.originalName}`, "longcat-avatar", "GENERATED", fileName, input.originalName, "video/mp4", input.bytes.length, checksum, localPath, JSON.stringify(input.metadata), input.now, input.now);
  return getAsset(db, projectId, input.id);
}

function insertGenerationJob(db: Database.Database, id: string, projectId: string, providerKey: string, status: LongCatJobStatus, request: unknown, timestamp: string) {
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, providerKey, status, JSON.stringify(request), null, timestamp, timestamp);
  recordGenerationStatusHistory(db, { generationJobId: id, status, createdAt: timestamp, message: "Generation job created", providerStatus: providerKey });
}

function updateGenerationJob(db: Database.Database, id: string, status: LongCatJobStatus, timestamp: string, logText: string, result: unknown = null, providerStatus?: string) {
  db.prepare("UPDATE media_generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=?")
    .run(status, JSON.stringify({ log: sanitizeLog(logText), result }), timestamp, id);
  recordGenerationStatusHistory(db, { generationJobId: id, status, createdAt: timestamp, message: sanitizeLog(logText), providerStatus });
}

function getScene(db: Database.Database, projectId: string, sceneId: string): SceneRow {
  const scene = db.prepare("SELECT id,title,dialogue,visual_prompt AS visualPrompt FROM media_scenes WHERE id=? AND media_project_id=?").get(sceneId, projectId) as SceneRow | undefined;
  if (!scene) throw new MediaStudioError("Media scene not found", 404);
  return scene;
}

function getSceneAsset(db: Database.Database, projectId: string, sceneId: string, kind: "image" | "audio"): AssetRow {
  const prefix = kind === "image" ? "image/%" : "audio/%";
  const asset = db.prepare(`SELECT id,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,local_path AS localPath FROM media_assets
    WHERE media_project_id=? AND scene_id=? AND kind=? AND mime_type LIKE ? AND local_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(projectId, sceneId, kind, prefix) as AssetRow | undefined;
  if (!asset) throw new MediaStudioError(`LongCat presenter generation requires a scene ${kind} asset`, 409);
  return asset;
}

function getGenerationJob(db: Database.Database, id: string) {
  const job = db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_generation_jobs WHERE id=?`).get(id) as GenerationJobRow | undefined;
  if (!job) throw new MediaStudioError("Generation job not found", 404);
  return job;
}

function getAsset(db: Database.Database, projectId: string, assetId: string): StoredAssetRow {
  const asset = db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE media_project_id=? AND id=?`).get(projectId, assetId) as StoredAssetRow | undefined;
  if (!asset) throw new MediaStudioError("Media asset not found", 404);
  return asset;
}

function parseRemoteJobId(resultJson: string | null): string | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as { result?: { remoteJobId?: unknown } };
    return typeof parsed.result?.remoteJobId === "string" ? parsed.result.remoteJobId : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetchImpl: LongCatHttp) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function resolveStorageRoot(storageRoot?: string): string {
  return path.resolve(storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
}

function assertInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaStudioError("LongCat output path escapes storage root", 400);
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function trimBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function safeHostname(value: string) {
  try { return new URL(value).hostname; } catch { return "invalid-url"; }
}

function sanitizeLog(value: string) {
  const withoutUrlCredentials = value.replace(/(https?:\/\/)([^:/\s]+):([^@\s]+)@/gi, "$1[redacted]@");
  return withoutUrlCredentials
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, "api_key=[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .slice(0, 20_000);
}

type SceneRow = { id: string; title: string; dialogue: string; visualPrompt: string };
type AssetRow = { id: string; fileName: string | null; originalName: string | null; mimeType: string | null; localPath: string };
type StoredAssetRow = AssetRow & { source: string; status: string; sizeBytes: number | null; checksumSha256: string | null };
type GenerationJobRow = { id: string; mediaProjectId: string; providerKey: string; status: string; requestJson: string; resultJson: string | null; createdAt: string; updatedAt: string };
type LongCatPollResponse = { status?: string; progress?: number; error?: string; filename?: string; output_url?: string; output?: { filename?: string; url?: string } };
