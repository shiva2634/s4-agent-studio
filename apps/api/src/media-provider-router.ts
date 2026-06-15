import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MediaStudioError, getSceneProviderPrompt, type MediaAuditWriter } from "./media-studio.js";
import { generateWanForScene, loadComfyConfig, type ComfyConfig, type ComfyHttp } from "./comfyui-provider.js";
import { generateLongCatPresenter, loadLongCatConfig, type LongCatConfig, type LongCatHttp } from "./longcat-provider.js";
import { generateExternalMedia, loadLtxConfig, loadOviConfig, type ExternalMediaConfig, type ExternalMediaHttp } from "./ovi-ltx-provider.js";
import { processMediaAsset, type MediaProcessingOptions } from "./media-processing.js";
import { recordGenerationStatusHistory } from "./media-generation-history.js";

export type MediaProviderTask = "T2V" | "I2V" | "PRESENTER" | "AUDIO_VIDEO";
export type ProviderKey = "google-flow" | "wan-2.2" | "longcat-avatar" | "ovi" | "ltx";
export type ProviderExecutionMode = "COMFYUI" | "LONGCAT" | "HTTP" | "HUMAN_ASSISTED" | "DISABLED";

export type ProviderCapability = {
  key: ProviderKey;
  name: string;
  supports: MediaProviderTask[];
  enabled: boolean;
  healthy: boolean;
  priority: number;
  paid: boolean;
  mode: ProviderExecutionMode;
  reason: string;
};

type RouterAdapter = (input: {
  db: Database.Database;
  projectId: string;
  sceneId: string;
  jobId: string;
  outputAssetId: string;
  now: string;
  task: MediaProviderTask;
  approved: boolean;
  fps?: number;
  seed?: number;
  config?: ComfyConfig;
  fetchImpl?: ComfyHttp;
  longCatConfig?: LongCatConfig;
  longCatFetchImpl?: LongCatHttp;
  oviConfig?: ExternalMediaConfig;
  oviFetchImpl?: ExternalMediaHttp;
  ltxConfig?: ExternalMediaConfig;
  ltxFetchImpl?: ExternalMediaHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
  audit: MediaAuditWriter;
}) => Promise<unknown>;

export type ProviderRouterOptions = {
  jobId: string;
  outputAssetId: string;
  now: string;
  task: MediaProviderTask;
  providerKey?: ProviderKey;
  approved: boolean;
  paidProviderApproved?: boolean;
  maxAttempts?: number;
  fps?: number;
  seed?: number;
  config?: ComfyConfig;
  fetchImpl?: ComfyHttp;
  longCatConfig?: LongCatConfig;
  longCatFetchImpl?: LongCatHttp;
  oviConfig?: ExternalMediaConfig;
  oviFetchImpl?: ExternalMediaHttp;
  ltxConfig?: ExternalMediaConfig;
  ltxFetchImpl?: ExternalMediaHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
  capabilities?: ProviderCapability[];
  adapters?: Partial<Record<ProviderKey, RouterAdapter>>;
};

export function getMediaProviderCapabilities(config: ComfyConfig = loadComfyConfig(), longCatConfig: LongCatConfig = loadLongCatConfig(), oviConfig: ExternalMediaConfig = loadOviConfig(), ltxConfig: ExternalMediaConfig = loadLtxConfig()): ProviderCapability[] {
  return [
    {
      key: "wan-2.2",
      name: "Wan 2.2",
      supports: ["T2V", "I2V"],
      enabled: config.enabled,
      healthy: config.enabled,
      priority: 20,
      paid: false,
      mode: "COMFYUI",
      reason: config.enabled ? "Local ComfyUI Wan adapter is enabled" : "ComfyUI is disabled"
    },
    {
      key: "google-flow",
      name: "Google Flow",
      supports: ["T2V", "I2V", "PRESENTER"],
      enabled: true,
      healthy: true,
      priority: 5,
      paid: true,
      mode: "HUMAN_ASSISTED",
      reason: "Flow is human-assisted until provider API integration exists"
    },
    {
      key: "longcat-avatar",
      name: "LongCat Avatar",
      supports: ["PRESENTER"],
      enabled: longCatConfig.enabled,
      healthy: longCatConfig.enabled,
      priority: 4,
      paid: true,
      mode: "LONGCAT",
      reason: longCatConfig.enabled ? "LongCat Avatar adapter is enabled" : "LongCat adapter is disabled"
    },
    {
      key: "ovi",
      name: "Ovi",
      supports: ["AUDIO_VIDEO", "T2V"],
      enabled: oviConfig.enabled,
      healthy: oviConfig.enabled,
      priority: 30,
      paid: false,
      mode: oviConfig.enabled ? "HTTP" : "DISABLED",
      reason: oviConfig.enabled ? "Ovi adapter is enabled" : "Ovi adapter is disabled"
    },
    {
      key: "ltx",
      name: "LTX",
      supports: ["T2V", "I2V"],
      enabled: ltxConfig.enabled,
      healthy: ltxConfig.enabled,
      priority: 40,
      paid: true,
      mode: ltxConfig.enabled ? "HTTP" : "DISABLED",
      reason: ltxConfig.enabled ? "LTX adapter is enabled; paid-provider approval required" : "LTX adapter is disabled"
    }
  ];
}

export function selectMediaProviders(task: MediaProviderTask, capabilities: ProviderCapability[]) {
  const ordered = capabilities
    .filter((provider) => provider.supports.includes(task))
    .sort((a, b) => a.priority - b.priority);
  const selected = ordered.find((provider) => provider.enabled && provider.healthy);
  return {
    task,
    selected: selected ?? null,
    candidates: ordered,
    skipped: ordered.filter((provider) => provider !== selected).map((provider) => ({
      key: provider.key,
      reason: provider.enabled ? provider.healthy ? "Lower priority fallback" : "Provider is unhealthy" : "Provider is disabled"
    })),
    reason: selected ? `${selected.name} selected: ${selected.reason}` : `No enabled healthy provider supports ${task}`
  };
}

export async function routeMediaGeneration(db: Database.Database, projectId: string, sceneId: string, options: ProviderRouterOptions, audit: MediaAuditWriter) {
  if (!options.approved) throw new MediaStudioError("Media provider routing requires explicit approval", 403);
  const capabilities = options.capabilities ?? getMediaProviderCapabilities(options.config, options.longCatConfig, options.oviConfig, options.ltxConfig);
  const candidates = getProviderCandidates(capabilities, options.task, options.providerKey);
  const maxAttempts = options.maxAttempts ?? 2;
  const attempted: Array<{ providerKey: ProviderKey; status: "SKIPPED" | "FAILED" | "SELECTED" | "HUMAN_ASSISTED"; reason: string }> = [];
  recordGenerationStatusHistory(db, { generationJobId: options.jobId, status: "ROUTING", createdAt: options.now, message: `Selecting media provider for ${options.task}` });
  audit("MEDIA_PROVIDER_ROUTE_SELECTION_STARTED", `Selecting media provider for ${options.task}`, { projectId, payload: { sceneId, task: options.task, providerKey: options.providerKey, maxAttempts } });

  let attempts = 0;
  for (const provider of candidates) {
    if (attempts >= maxAttempts) break;
    if (!provider.enabled) {
      attempted.push({ providerKey: provider.key, status: "SKIPPED", reason: "Provider is disabled" });
      continue;
    }
    if (!provider.healthy) {
      attempted.push({ providerKey: provider.key, status: "SKIPPED", reason: "Provider is unhealthy" });
      audit("MEDIA_PROVIDER_ROUTE_FALLBACK", `${provider.name} skipped: unhealthy`, { projectId, payload: { sceneId, providerKey: provider.key, task: options.task } });
      continue;
    }
    if (provider.paid && !options.paidProviderApproved) {
      audit("MEDIA_PROVIDER_ROUTE_PAID_APPROVAL_REQUIRED", `${provider.name} requires paid-provider approval`, { projectId, payload: { sceneId, providerKey: provider.key, task: options.task } });
      throw new MediaStudioError(`${provider.name} requires paid-provider approval`, 403);
    }
    attempts += 1;
    recordGenerationStatusHistory(db, { generationJobId: options.jobId, status: "PROVIDER_SELECTED", createdAt: options.now, message: `${provider.name} selected for ${options.task}`, providerStatus: provider.key });
    audit("MEDIA_PROVIDER_ROUTE_SELECTED", `${provider.name} selected for ${options.task}`, { projectId, payload: { sceneId, providerKey: provider.key, task: options.task, reason: provider.reason, attempt: attempts } });
    if (provider.mode === "HUMAN_ASSISTED") {
      const flowPackage = buildFlowPackage(db, projectId, sceneId, options.task, options.now);
      insertHumanAssistedJob(db, options.jobId, projectId, sceneId, provider, options, provider.reason, flowPackage);
      attempted.push({ providerKey: provider.key, status: "HUMAN_ASSISTED", reason: provider.reason });
      persistRouting(db, options.jobId, { selectedProvider: provider.key, reason: provider.reason, attempted });
      audit("MEDIA_FLOW_JOB_CREATED", `Flow package created for ${flowPackage.scene.title}`, { projectId, payload: { sceneId, jobId: options.jobId, task: options.task, package: flowPackage } });
      return { job: getGenerationJob(db, options.jobId), routing: { selectedProvider: provider.key, reason: provider.reason, attempted } };
    }
    const adapter = options.adapters?.[provider.key] ?? defaultAdapter(provider.key);
    try {
      const result = await adapter({ db, projectId, sceneId, jobId: options.jobId, outputAssetId: options.outputAssetId, now: options.now, task: options.task, approved: options.approved, fps: options.fps, seed: options.seed, config: options.config, fetchImpl: options.fetchImpl, longCatConfig: options.longCatConfig, longCatFetchImpl: options.longCatFetchImpl, oviConfig: options.oviConfig, oviFetchImpl: options.oviFetchImpl, ltxConfig: options.ltxConfig, ltxFetchImpl: options.ltxFetchImpl, storageRoot: options.storageRoot, processOptions: options.processOptions, audit });
      attempted.push({ providerKey: provider.key, status: "SELECTED", reason: provider.reason });
      persistRouting(db, options.jobId, { selectedProvider: provider.key, reason: provider.reason, attempted });
      return { ...(isRecord(result) ? result : { result }), routing: { selectedProvider: provider.key, reason: provider.reason, attempted } };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Provider attempt failed";
      attempted.push({ providerKey: provider.key, status: "FAILED", reason });
      recordGenerationStatusHistory(db, { generationJobId: options.jobId, status: "FAILED", createdAt: options.now, message: reason, providerStatus: provider.key });
      audit("MEDIA_PROVIDER_ROUTE_FALLBACK", `${provider.name} failed; trying fallback`, { projectId, payload: { sceneId, providerKey: provider.key, task: options.task, reason } });
    }
  }
  audit("MEDIA_PROVIDER_ROUTE_EXHAUSTED", `No provider completed ${options.task}`, { projectId, payload: { sceneId, task: options.task, attempted } });
  throw new MediaStudioError(`No provider completed ${options.task}`, 409);
}

function getProviderCandidates(capabilities: ProviderCapability[], task: MediaProviderTask, providerKey?: ProviderKey) {
  const taskCandidates = capabilities.filter((provider) => provider.supports.includes(task));
  if (!providerKey) return taskCandidates.sort((a, b) => a.priority - b.priority);
  const provider = capabilities.find((candidate) => candidate.key === providerKey);
  if (!provider) throw new MediaStudioError(`Unknown media provider: ${providerKey}`, 400);
  if (!provider.supports.includes(task)) throw new MediaStudioError(`${provider.name} does not support ${task}`, 400);
  return [provider];
}

function defaultAdapter(providerKey: ProviderKey): RouterAdapter {
  if (providerKey === "wan-2.2") {
    return ({ db, projectId, sceneId, jobId, outputAssetId, now, task, approved, fps, seed, config, fetchImpl, storageRoot, processOptions, audit }) => generateWanForScene(db, projectId, sceneId, {
      jobId,
      outputAssetId,
      now,
      mode: task === "I2V" ? "image-to-video" : "text-to-video",
      approved,
      fps,
      seed,
      config,
      fetchImpl,
      storageRoot,
      processOptions
    }, audit);
  }
  if (providerKey === "longcat-avatar") {
    return ({ db, projectId, sceneId, jobId, outputAssetId, now, approved, longCatConfig, longCatFetchImpl, storageRoot, processOptions, audit }) => generateLongCatPresenter(db, projectId, sceneId, {
      jobId,
      outputAssetId,
      now,
      approved,
      config: longCatConfig,
      fetchImpl: longCatFetchImpl,
      storageRoot,
      processOptions
    }, audit);
  }
  if (providerKey === "ovi") {
    return ({ db, projectId, sceneId, jobId, outputAssetId, now, task, approved, oviConfig, oviFetchImpl, storageRoot, processOptions, audit }) => generateExternalMedia(db, projectId, sceneId, {
      providerKey: "ovi",
      task: task === "AUDIO_VIDEO" ? "AUDIO_VIDEO" : "T2V",
      jobId,
      outputAssetId,
      now,
      approved,
      config: oviConfig ?? loadOviConfig(),
      fetchImpl: oviFetchImpl,
      storageRoot,
      processOptions
    }, audit);
  }
  if (providerKey === "ltx") {
    return ({ db, projectId, sceneId, jobId, outputAssetId, now, task, approved, ltxConfig, ltxFetchImpl, storageRoot, processOptions, audit }) => generateExternalMedia(db, projectId, sceneId, {
      providerKey: "ltx",
      task: task === "I2V" ? "I2V" : "T2V",
      jobId,
      outputAssetId,
      now,
      approved,
      config: ltxConfig ?? loadLtxConfig(),
      fetchImpl: ltxFetchImpl,
      storageRoot,
      processOptions
    }, audit);
  }
  return async () => {
    throw new MediaStudioError(`${providerKey} adapter is disabled`, 409);
  };
}

export function getFlowPackage(db: Database.Database, projectId: string, jobId: string): FlowPackage {
  const job = getFlowJob(db, projectId, jobId);
  const flowPackage = parseJobResult(job).flowPackage;
  if (!flowPackage) throw new MediaStudioError("Flow job has no package", 404);
  return flowPackage;
}

export function markFlowGenerated(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter) {
  const job = getFlowJob(db, projectId, jobId);
  if (!["WAITING_FOR_USER", "GENERATED"].includes(job.status)) throw new MediaStudioError("Flow job cannot be marked generated from this state", 409);
  updateFlowJobResult(db, jobId, "GENERATED", timestamp, { generatedAt: timestamp });
  audit("MEDIA_FLOW_JOB_GENERATED", "Flow job marked generated", { projectId, payload: { jobId } });
  return getGenerationJob(db, jobId);
}

export function cancelFlowJob(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter) {
  const job = getFlowJob(db, projectId, jobId);
  if (["IMPORTED", "FAILED", "CANCELLED"].includes(job.status)) throw new MediaStudioError("Flow job is already finalized", 409);
  updateFlowJobResult(db, jobId, "CANCELLED", timestamp, { cancelledAt: timestamp });
  audit("MEDIA_FLOW_JOB_CANCELLED", "Flow job cancelled", { projectId, payload: { jobId } });
  return getGenerationJob(db, jobId);
}

export function rejectFlowJob(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter, reason?: string) {
  const job = getFlowJob(db, projectId, jobId);
  if (["IMPORTED", "FAILED", "CANCELLED"].includes(job.status)) throw new MediaStudioError("Flow job is already finalized", 409);
  updateFlowJobResult(db, jobId, "FAILED", timestamp, { rejectedAt: timestamp, rejectionReason: reason ?? "Rejected by user" });
  audit("MEDIA_FLOW_JOB_REJECTED", "Flow job rejected", { projectId, payload: { jobId, reason } });
  return getGenerationJob(db, jobId);
}

export function retryFlowJob(db: Database.Database, projectId: string, jobId: string, input: { jobId: string; now: string }, audit: MediaAuditWriter) {
  const previous = getFlowJob(db, projectId, jobId);
  recordGenerationStatusHistory(db, { generationJobId: jobId, status: "RETRIED", createdAt: input.now, message: `Retry requested as ${input.jobId}`, providerStatus: "google-flow" });
  const request = JSON.parse(previous.requestJson) as { sceneId: string; task: MediaProviderTask };
  const flowPackage = buildFlowPackage(db, projectId, request.sceneId, request.task, input.now);
  const provider = getMediaProviderCapabilities().find((item) => item.key === "google-flow") as ProviderCapability;
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(input.jobId, projectId, "google-flow", "WAITING_FOR_USER", JSON.stringify({ task: request.task, providerKey: "google-flow", sceneId: request.sceneId, retryOf: jobId }), JSON.stringify({ flowPackage, flowLink: flowLink(), lifecycle: { waitingAt: input.now }, routing: { selectedProvider: "google-flow", reason: provider.reason } }), input.now, input.now);
  recordGenerationStatusHistory(db, { generationJobId: input.jobId, status: "WAITING_FOR_USER", createdAt: input.now, message: "Flow retry package created", providerStatus: "google-flow" });
  audit("MEDIA_FLOW_JOB_RETRIED", "Flow job retried", { projectId, payload: { previousJobId: jobId, jobId: input.jobId, sceneId: request.sceneId } });
  return getGenerationJob(db, input.jobId);
}

export async function fallbackFlowJobToWan(db: Database.Database, projectId: string, jobId: string, input: {
  jobId: string;
  outputAssetId: string;
  now: string;
  approved: boolean;
  config?: ComfyConfig;
  fetchImpl?: ComfyHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  const previous = getFlowJob(db, projectId, jobId);
  const request = JSON.parse(previous.requestJson) as { sceneId: string; task: MediaProviderTask };
  updateFlowJobResult(db, jobId, "CANCELLED", input.now, { fallbackToWanAt: input.now });
  audit("MEDIA_FLOW_JOB_FALLBACK_TO_WAN", "Flow job fallback to Wan requested", { projectId, payload: { jobId, nextJobId: input.jobId, sceneId: request.sceneId } });
  return generateWanForScene(db, projectId, request.sceneId, {
    jobId: input.jobId,
    outputAssetId: input.outputAssetId,
    now: input.now,
    mode: request.task === "I2V" ? "image-to-video" : "text-to-video",
    approved: input.approved,
    config: input.config,
    fetchImpl: input.fetchImpl,
    storageRoot: input.storageRoot,
    processOptions: input.processOptions
  }, audit);
}

export async function importFlowGeneratedAsset(db: Database.Database, projectId: string, jobId: string, input: {
  assetId: string;
  processingJobId: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  now: string;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  const job = getFlowJob(db, projectId, jobId);
  if (!["WAITING_FOR_USER", "GENERATED"].includes(job.status)) throw new MediaStudioError("Flow job cannot import from this state", 409);
  const request = JSON.parse(job.requestJson) as { sceneId: string };
  const asset = await saveFlowAsset(db, projectId, request.sceneId, input);
  const processing = await processMediaAsset(db, projectId, asset.id, { jobId: input.processingJobId, now: input.now, storageRoot: input.storageRoot, ...input.processOptions }, audit);
  db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, request.sceneId, projectId);
  updateFlowJobResult(db, jobId, "IMPORTED", input.now, { importedAt: input.now, assetId: asset.id, processing });
  audit("MEDIA_FLOW_ASSET_IMPORTED", `Flow generated file imported for ${input.originalName}`, { projectId, payload: { jobId, sceneId: request.sceneId, assetId: asset.id, mimeType: input.mimeType, sizeBytes: input.bytes.length } });
  return { job: getGenerationJob(db, jobId), asset: getAsset(db, projectId, asset.id), processing };
}

function insertHumanAssistedJob(db: Database.Database, id: string, projectId: string, sceneId: string, provider: ProviderCapability, options: ProviderRouterOptions, reason: string, flowPackage: FlowPackage) {
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, provider.key, "WAITING_FOR_USER", JSON.stringify({ task: options.task, providerKey: provider.key, sceneId }), JSON.stringify({ flowPackage, flowLink: flowLink(), lifecycle: { waitingAt: options.now }, routing: { reason, providerMode: provider.mode } }), options.now, options.now);
  recordGenerationStatusHistory(db, { generationJobId: id, status: "WAITING_FOR_USER", createdAt: options.now, message: "Flow package created", providerStatus: provider.key });
}

function getGenerationJob(db: Database.Database, id: string) {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_generation_jobs WHERE id=?`).get(id);
}

function persistRouting(db: Database.Database, jobId: string, routing: unknown) {
  const row = db.prepare("SELECT result_json AS resultJson FROM media_generation_jobs WHERE id=?").get(jobId) as { resultJson: string | null } | undefined;
  if (!row) return;
  let result: Record<string, unknown> = {};
  if (row.resultJson) {
    try {
      const parsed = JSON.parse(row.resultJson) as unknown;
      if (isRecord(parsed)) result = parsed;
    } catch {
      result = {};
    }
  }
  db.prepare("UPDATE media_generation_jobs SET result_json=? WHERE id=?").run(JSON.stringify({ ...result, routing }), jobId);
}

function buildFlowPackage(db: Database.Database, projectId: string, sceneId: string, task: MediaProviderTask, timestamp: string): FlowPackage {
  const scene = getScene(db, projectId, sceneId);
  const references = db.prepare(`SELECT id,label,kind,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,local_path AS localPath
    FROM media_assets WHERE media_project_id=? AND scene_id=? ORDER BY created_at`).all(projectId, sceneId) as FlowPackage["references"];
  return {
    packageVersion: 1,
    provider: "google-flow",
    task,
    createdAt: timestamp,
    scene: {
      id: scene.id,
      title: scene.title,
      prompt: scene.visualPrompt,
      dialogue: scene.dialogue,
      aspectRatio: scene.aspectRatio,
      durationSeconds: scene.durationSeconds
    },
    prompt: getSceneProviderPrompt(db, projectId, sceneId),
    references
  };
}

async function saveFlowAsset(db: Database.Database, projectId: string, sceneId: string, input: { assetId: string; originalName: string; mimeType: string; bytes: Buffer; now: string; storageRoot?: string }): Promise<FlowAssetRow> {
  const kind = input.mimeType.startsWith("image/") ? "image" : input.mimeType.startsWith("video/") ? "video" : null;
  if (!kind) throw new MediaStudioError("Flow import requires an image or video file", 400);
  const storageRoot = path.resolve(input.storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
  const fileName = `${sanitizeSegment(input.assetId)}-${sanitizeSegment(input.originalName)}`;
  const localPath = path.resolve(storageRoot, sanitizeSegment(projectId), sanitizeSegment(sceneId), fileName);
  assertInsideRoot(localPath, storageRoot);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.assetId, projectId, sceneId, kind, input.originalName, "google-flow", "GENERATED", fileName, input.originalName, input.mimeType, input.bytes.length, checksum, localPath, JSON.stringify({ provider: "google-flow" }), input.now, input.now);
  return getAsset(db, projectId, input.assetId);
}

function getFlowJob(db: Database.Database, projectId: string, jobId: string) {
  const job = getGenerationJob(db, jobId) as { id: string; mediaProjectId: string; providerKey: string; status: string; requestJson: string; resultJson: string | null } | undefined;
  if (!job || job.mediaProjectId !== projectId || job.providerKey !== "google-flow") throw new MediaStudioError("Flow generation job not found", 404);
  return job;
}

function parseJobResult(job: { resultJson: string | null }) {
  if (!job.resultJson) throw new MediaStudioError("Flow job has no package", 404);
  const parsed = JSON.parse(job.resultJson) as { flowPackage?: FlowPackage; flowLink?: string; lifecycle?: Record<string, unknown>; routing?: unknown };
  if (!parsed.flowPackage) throw new MediaStudioError("Flow job has no package", 404);
  return parsed;
}

function updateFlowJobResult(db: Database.Database, jobId: string, status: string, timestamp: string, lifecyclePatch: Record<string, unknown>) {
  const job = getGenerationJob(db, jobId) as { resultJson: string | null };
  const result = job.resultJson ? JSON.parse(job.resultJson) as Record<string, unknown> : {};
  const lifecycle = isRecord(result.lifecycle) ? result.lifecycle : {};
  db.prepare("UPDATE media_generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=?").run(status, JSON.stringify({ ...result, lifecycle: { ...lifecycle, ...lifecyclePatch } }), timestamp, jobId);
  recordGenerationStatusHistory(db, { generationJobId: jobId, status, createdAt: timestamp, message: status === "FAILED" ? "Flow job failed or rejected" : `Flow job ${status.toLowerCase()}`, providerStatus: "google-flow" });
}

function getScene(db: Database.Database, projectId: string, sceneId: string) {
  const scene = db.prepare("SELECT id,title,dialogue,visual_prompt AS visualPrompt,aspect_ratio AS aspectRatio,duration_seconds AS durationSeconds FROM media_scenes WHERE id=? AND media_project_id=?").get(sceneId, projectId) as FlowPackage["scene"] & { visualPrompt: string } | undefined;
  if (!scene) throw new MediaStudioError("Media scene not found", 404);
  return scene;
}

function getAsset(db: Database.Database, projectId: string, assetId: string): FlowAssetRow {
  const asset = db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE media_project_id=? AND id=?`).get(projectId, assetId) as FlowAssetRow | undefined;
  if (!asset) throw new MediaStudioError("Media asset not found", 404);
  return asset;
}

function flowLink() {
  return "https://labs.google/fx/tools/flow";
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function assertInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaStudioError("Flow asset path escapes storage root", 400);
}

type FlowPackage = {
  packageVersion: number;
  provider: "google-flow";
  task: MediaProviderTask;
  createdAt: string;
  scene: {
    id: string;
    title: string;
    prompt: string;
    dialogue: string;
    aspectRatio: string;
    durationSeconds: number;
  };
  prompt: string;
  references: Array<{ id: string; label: string; kind: string; fileName: string | null; originalName: string | null; mimeType: string | null; sizeBytes: number | null; localPath: string | null }>;
};

type FlowAssetRow = {
  id: string;
  source: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
