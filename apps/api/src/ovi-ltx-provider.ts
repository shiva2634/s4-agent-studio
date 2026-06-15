import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MediaStudioError, getSceneProviderPrompt, type MediaAuditWriter } from "./media-studio.js";
import { processMediaAsset, type MediaProcessingOptions } from "./media-processing.js";
import { recordGenerationStatusHistory } from "./media-generation-history.js";

export type ExternalMediaProviderKey = "ovi" | "ltx";
export type ExternalMediaTask = "T2V" | "I2V" | "AUDIO_VIDEO";
export type ExternalMediaHttp = typeof fetch;
export type ExternalMediaConfig = { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number };

const defaultTimeoutMs = 120_000;

export function loadOviConfig(env: NodeJS.ProcessEnv = process.env): ExternalMediaConfig {
  return { enabled: (env.OVI_ENABLED ?? "false").toLowerCase() === "true", baseUrl: env.OVI_BASE_URL ?? "http://127.0.0.1:8391", apiKey: env.OVI_API_KEY ?? "", timeoutMs: parseTimeout(env.OVI_TIMEOUT_MS) };
}

export function loadLtxConfig(env: NodeJS.ProcessEnv = process.env): ExternalMediaConfig {
  return { enabled: (env.LTX_ENABLED ?? "false").toLowerCase() === "true", baseUrl: env.LTX_BASE_URL ?? "http://127.0.0.1:8491", apiKey: env.LTX_API_KEY ?? "", timeoutMs: parseTimeout(env.LTX_TIMEOUT_MS) };
}

export function externalProviderStatusResponse(config: ExternalMediaConfig) {
  return { enabled: config.enabled, baseUrlHostname: safeHostname(config.baseUrl), timeoutMs: config.timeoutMs };
}

export async function testExternalProviderConnection(providerKey: ExternalMediaProviderKey, config: ExternalMediaConfig, fetchImpl: ExternalMediaHttp = fetch) {
  if (!config.enabled) return { status: "disabled", ...externalProviderStatusResponse(config), lastTestedAt: new Date().toISOString() };
  try {
    const response = await fetchWithTimeout(providerKey, `${trimBaseUrl(assertValidBaseUrl(config.baseUrl))}/health`, { method: "GET", headers: authHeaders(config) }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`${providerName(providerKey)} health check failed: ${response.status}`);
    return { status: "ok", ...externalProviderStatusResponse(config), lastTestedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "error", ...externalProviderStatusResponse(config), lastTestedAt: new Date().toISOString(), sanitizedError: sanitizeLog(error instanceof Error ? error.message : String(error)) };
  }
}

export async function generateExternalMedia(db: Database.Database, projectId: string, sceneId: string, input: {
  providerKey: ExternalMediaProviderKey;
  task: ExternalMediaTask;
  jobId: string;
  outputAssetId: string;
  now: string;
  approved: boolean;
  config: ExternalMediaConfig;
  fetchImpl?: ExternalMediaHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  if (!input.approved) throw new MediaStudioError(`${providerName(input.providerKey)} generation requires explicit approval`, 403);
  if (!input.config.enabled) throw new MediaStudioError(`${providerName(input.providerKey)} provider is disabled`, 409);
  assertValidBaseUrl(input.config.baseUrl);
  assertSupportedTask(input.providerKey, input.task);
  const scene = getScene(db, projectId, sceneId);
  const prompt = getSceneProviderPrompt(db, projectId, sceneId);
  const image = input.task === "I2V" ? getSceneAsset(db, projectId, sceneId, "image") : null;
  const audio = input.task === "AUDIO_VIDEO" ? getSceneAsset(db, projectId, sceneId, "audio") : null;
  const fetchImpl = input.fetchImpl ?? fetch;
  const storageRoot = resolveStorageRoot(input.storageRoot);

  insertGenerationJob(db, input.jobId, projectId, input.providerKey, "QUEUED", { sceneId, task: input.task, prompt }, input.now);
  updateGenerationJob(db, input.jobId, "RUNNING", input.now, `Starting ${providerName(input.providerKey)} ${input.task} generation`);
  audit(`MEDIA_${input.providerKey.toUpperCase()}_GENERATION_STARTED`, `${providerName(input.providerKey)} generation started for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId, task: input.task } });

  try {
    const remoteJobId = await submitExternalJob(input.config, { providerKey: input.providerKey, task: input.task, prompt, scene, image, audio }, fetchImpl);
    updateGenerationJob(db, input.jobId, "RUNNING", input.now, `Submitted ${providerName(input.providerKey)} job ${remoteJobId}`, { remoteJobId }, "submitted");
    const output = await pollExternalOutput(input.config, input.providerKey, remoteJobId, fetchImpl, (status, progress) => {
      recordGenerationStatusHistory(db, { generationJobId: input.jobId, status: "RUNNING", createdAt: input.now, progressPercent: progress, message: `${providerName(input.providerKey)} generation update`, providerStatus: status });
    });
    const bytes = await downloadExternalOutput(input.config, input.providerKey, remoteJobId, output, fetchImpl);
    const asset = await saveGeneratedVideoAsset(db, projectId, sceneId, {
      id: input.outputAssetId,
      providerKey: input.providerKey,
      originalName: output.filename ?? `${input.providerKey}-output.mp4`,
      bytes,
      now: input.now,
      storageRoot,
      metadata: { remoteJobId, provider: input.providerKey, task: input.task }
    });
    updateGenerationJob(db, input.jobId, "COMPLETED", input.now, `Generated ${asset.originalName ?? asset.fileName ?? providerName(input.providerKey)}`, { remoteJobId, output, assetId: asset.id });
    db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
    audit(`MEDIA_${input.providerKey.toUpperCase()}_GENERATION_COMPLETED`, `${providerName(input.providerKey)} generation completed for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId, assetId: asset.id } });
    await processMediaAsset(db, projectId, asset.id, { jobId: `${input.jobId}-qc`, now: input.now, storageRoot, ...input.processOptions }, audit);
    return { job: getGenerationJob(db, input.jobId), asset: getAsset(db, projectId, asset.id) };
  } catch (error) {
    const message = sanitizeLog(error instanceof Error ? error.message : String(error));
    updateGenerationJob(db, input.jobId, "FAILED", input.now, message);
    audit(`MEDIA_${input.providerKey.toUpperCase()}_GENERATION_FAILED`, message, { projectId, payload: { sceneId, jobId: input.jobId } });
    throw new MediaStudioError(message, 502);
  }
}

export async function cancelExternalGeneration(db: Database.Database, projectId: string, jobId: string, providerKey: ExternalMediaProviderKey, timestamp: string, audit: MediaAuditWriter, config: ExternalMediaConfig, fetchImpl: ExternalMediaHttp = fetch) {
  const job = getGenerationJob(db, jobId);
  if (job.mediaProjectId !== projectId || job.providerKey !== providerKey) throw new MediaStudioError("Generation job not found", 404);
  const remoteJobId = parseRemoteJobId(job.resultJson);
  if (remoteJobId && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && config.enabled) {
    await fetchWithTimeout(providerKey, `${trimBaseUrl(assertValidBaseUrl(config.baseUrl))}/jobs/${encodeURIComponent(remoteJobId)}/cancel`, { method: "POST", headers: authHeaders(config) }, config.timeoutMs, fetchImpl).catch(() => undefined);
  }
  updateGenerationJob(db, jobId, "CANCELLED", timestamp, `${providerName(providerKey)} generation cancelled`, remoteJobId ? { remoteJobId } : null);
  audit(`MEDIA_${providerKey.toUpperCase()}_GENERATION_CANCELLED`, `${providerName(providerKey)} generation cancelled`, { projectId, payload: { jobId, remoteJobId } });
  return getGenerationJob(db, jobId);
}

export async function retryExternalGeneration(db: Database.Database, projectId: string, jobId: string, input: {
  jobId: string;
  outputAssetId: string;
  now: string;
  approved: boolean;
  config: ExternalMediaConfig;
  fetchImpl?: ExternalMediaHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  const previous = getGenerationJob(db, jobId);
  if (previous.providerKey !== "ovi" && previous.providerKey !== "ltx") throw new MediaStudioError("Generation job is not Ovi or LTX", 400);
  recordGenerationStatusHistory(db, { generationJobId: jobId, status: "RETRIED", createdAt: input.now, message: `Retry requested as ${input.jobId}` });
  const request = JSON.parse(previous.requestJson) as { sceneId: string; task: ExternalMediaTask };
  return generateExternalMedia(db, projectId, request.sceneId, { ...input, providerKey: previous.providerKey, task: request.task }, audit);
}

async function submitExternalJob(config: ExternalMediaConfig, input: { providerKey: ExternalMediaProviderKey; task: ExternalMediaTask; prompt: string; scene: SceneRow; image: AssetRow | null; audio: AssetRow | null }, fetchImpl: ExternalMediaHttp) {
  const baseUrl = assertValidBaseUrl(config.baseUrl);
  const body = JSON.stringify({
    task: input.task,
    prompt: input.prompt,
    scene: { id: input.scene.id, title: input.scene.title, dialogue: input.scene.dialogue },
    references: {
      image: input.image ? { fileName: input.image.fileName ?? input.image.originalName, mimeType: input.image.mimeType } : null,
      audio: input.audio ? { fileName: input.audio.fileName ?? input.audio.originalName, mimeType: input.audio.mimeType } : null
    }
  });
  const response = await fetchWithTimeout(input.providerKey, `${trimBaseUrl(baseUrl)}/jobs`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders(config) }, body }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`${providerName(input.providerKey)} submit failed: ${response.status}`);
  const data = await readJsonResponse(response, input.providerKey, "submit") as { job_id?: unknown; id?: unknown };
  const jobId = typeof data.job_id === "string" ? data.job_id : typeof data.id === "string" ? data.id : "";
  if (!jobId) throw new Error(`${providerName(input.providerKey)} did not return a job id`);
  return jobId;
}

async function pollExternalOutput(config: ExternalMediaConfig, providerKey: ExternalMediaProviderKey, remoteJobId: string, fetchImpl: ExternalMediaHttp, onStatus?: (status: string, progress?: number) => void) {
  const baseUrl = assertValidBaseUrl(config.baseUrl);
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() <= deadline) {
    const response = await fetchWithTimeout(providerKey, `${trimBaseUrl(baseUrl)}/jobs/${encodeURIComponent(remoteJobId)}`, { method: "GET", headers: authHeaders(config) }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`${providerName(providerKey)} poll failed: ${response.status}`);
    const data = await readJsonResponse(response, providerKey, "poll") as PollResponse;
    if (typeof data.status !== "string" || !data.status.trim()) throw new Error(`${providerName(providerKey)} poll response is missing status`);
    const status = data.status.toLowerCase();
    onStatus?.(status, typeof data.progress === "number" ? data.progress : undefined);
    if (["failed", "error"].includes(status)) throw new Error(data.error ?? `${providerName(providerKey)} job failed`);
    if (["cancelled", "canceled"].includes(status)) throw new Error(`${providerName(providerKey)} job was cancelled`);
    if (["completed", "succeeded", "success"].includes(status)) return { filename: data.output?.filename ?? data.filename ?? `${providerKey}-output.mp4`, url: data.output?.url ?? data.output_url };
    if (!["queued", "pending", "running", "processing", "in_progress"].includes(status)) throw new Error(`${providerName(providerKey)} returned unsupported status ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${providerName(providerKey)} generation timed out`);
}

async function downloadExternalOutput(config: ExternalMediaConfig, providerKey: ExternalMediaProviderKey, remoteJobId: string, output: { filename?: string; url?: string }, fetchImpl: ExternalMediaHttp) {
  const baseUrl = assertValidBaseUrl(config.baseUrl);
  const url = output.url ? resolveProviderOutputUrl(baseUrl, output.url, providerKey) : `${trimBaseUrl(baseUrl)}/jobs/${encodeURIComponent(remoteJobId)}/output`;
  const response = await fetchWithTimeout(providerKey, url, { method: "GET", headers: authHeaders(config) }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`${providerName(providerKey)} output download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function saveGeneratedVideoAsset(db: Database.Database, projectId: string, sceneId: string, input: { id: string; providerKey: ExternalMediaProviderKey; originalName: string; bytes: Buffer; now: string; storageRoot: string; metadata: unknown }) {
  const fileName = `${sanitizeSegment(input.id)}-${input.providerKey}.mp4`;
  const localPath = path.resolve(input.storageRoot, sanitizeSegment(projectId), sanitizeSegment(sceneId), fileName);
  assertInsideRoot(localPath, input.storageRoot);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, sceneId, "video", `${providerName(input.providerKey)} generated ${input.originalName}`, input.providerKey, "GENERATED", fileName, input.originalName, "video/mp4", input.bytes.length, checksum, localPath, JSON.stringify(input.metadata), input.now, input.now);
  return getAsset(db, projectId, input.id);
}

function assertSupportedTask(providerKey: ExternalMediaProviderKey, task: ExternalMediaTask) {
  if (providerKey === "ovi" && task !== "T2V" && task !== "AUDIO_VIDEO") throw new MediaStudioError("Ovi supports T2V and AUDIO_VIDEO", 400);
  if (providerKey === "ltx" && task !== "T2V" && task !== "I2V") throw new MediaStudioError("LTX supports T2V and I2V", 400);
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
  if (!asset) throw new MediaStudioError(`${kind} asset is required for this provider task`, 409);
  return asset;
}

function insertGenerationJob(db: Database.Database, id: string, projectId: string, providerKey: string, status: string, request: unknown, timestamp: string) {
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, providerKey, status, JSON.stringify(request), null, timestamp, timestamp);
  recordGenerationStatusHistory(db, { generationJobId: id, status, createdAt: timestamp, message: "Generation job created", providerStatus: providerKey });
}

function updateGenerationJob(db: Database.Database, id: string, status: string, timestamp: string, logText: string, result: unknown = null, providerStatus?: string) {
  db.prepare("UPDATE media_generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=?").run(status, JSON.stringify({ log: sanitizeLog(logText), result }), timestamp, id);
  recordGenerationStatusHistory(db, { generationJobId: id, status, createdAt: timestamp, message: sanitizeLog(logText), providerStatus });
}

function getGenerationJob(db: Database.Database, id: string): GenerationJobRow {
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

async function fetchWithTimeout(providerKey: ExternalMediaProviderKey, url: string, init: RequestInit, timeoutMs: number, fetchImpl: ExternalMediaHttp) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  catch (error) {
    if (isAbortError(error)) throw new Error(`${providerName(providerKey)} request timed out after ${timeoutMs}ms`);
    throw error;
  }
  finally { clearTimeout(timer); }
}

function authHeaders(config: ExternalMediaConfig): Record<string, string> {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

function providerName(providerKey: ExternalMediaProviderKey) {
  return providerKey === "ovi" ? "Ovi" : "LTX";
}

function resolveStorageRoot(storageRoot?: string): string {
  return path.resolve(storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
}

function assertInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaStudioError("Provider output path escapes storage root", 400);
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function trimBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function assertValidBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new MediaStudioError("Provider base URL must be a valid HTTP(S) URL", 400);
  }
}

function resolveProviderOutputUrl(baseUrl: string, outputUrl: string, providerKey: ExternalMediaProviderKey): string {
  const base = new URL(baseUrl);
  const resolved = new URL(outputUrl, base);
  if (resolved.origin !== base.origin) throw new Error(`${providerName(providerKey)} output URL must stay on the configured provider host`);
  return resolved.toString();
}

async function readJsonResponse(response: Response, providerKey: ExternalMediaProviderKey, operation: string): Promise<unknown> {
  try {
    const parsed = await response.json() as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("response is not an object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "response is not an object") throw new Error(`${providerName(providerKey)} ${operation} response is not a JSON object`);
    throw new Error(`${providerName(providerKey)} ${operation} response is invalid JSON`);
  }
}

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value ?? defaultTimeoutMs);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : defaultTimeoutMs;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function safeHostname(value: string) {
  try { return new URL(value).hostname; } catch { return "invalid-url"; }
}

function sanitizeLog(value: string) {
  return value
    .replace(/(https?:\/\/)([^:/\s]+):([^@\s]+)@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, "api_key=[redacted]")
    .slice(0, 20_000);
}

type SceneRow = { id: string; title: string; dialogue: string; visualPrompt: string };
type AssetRow = { id: string; fileName: string | null; originalName: string | null; mimeType: string | null; localPath: string };
type StoredAssetRow = AssetRow & { source: string; status: string; sizeBytes: number | null; checksumSha256: string | null };
type GenerationJobRow = { id: string; mediaProjectId: string; providerKey: ExternalMediaProviderKey; status: string; requestJson: string; resultJson: string | null; createdAt: string; updatedAt: string };
type PollResponse = { status?: string; progress?: number; error?: string; filename?: string; output_url?: string; output?: { filename?: string; url?: string } };
