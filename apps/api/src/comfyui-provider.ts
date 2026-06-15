import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";
import { processMediaAsset, type MediaProcessingOptions } from "./media-processing.js";

export type ComfyJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type ComfyConfig = {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
};

export type ComfyHttp = typeof fetch;
export type ComfyWorkflowType = "WAN_T2V" | "WAN_I2V";
export type WanGenerationMode = "text-to-video" | "image-to-video";

export type ComfyWorkflowMapping = {
  prompt: string;
  image?: string;
  width: string;
  height: string;
  frames: string;
  fps: string;
  seed: string;
  outputNodeId: string;
};

export type ComfyWorkflowValidation = {
  valid: boolean;
  issues: Array<{ code: string; message: string }>;
};

export const wanTextToVideoWorkflowTemplate = {
  enabled: false,
  template: "wan-2.2-text-to-video-placeholder",
  prompt: "{{prompt}}",
  width: "{{width}}",
  height: "{{height}}",
  frames: "{{frames}}",
  note: "Replace this placeholder with a local Wan 2.2 ComfyUI workflow JSON."
};

export const wanImageToVideoWorkflowTemplate = {
  enabled: false,
  template: "wan-2.2-image-to-video-placeholder",
  prompt: "{{prompt}}",
  inputImage: "{{input_image}}",
  width: "{{width}}",
  height: "{{height}}",
  frames: "{{frames}}",
  note: "Replace this placeholder with a local Wan 2.2 image-to-video ComfyUI workflow JSON."
};

export function loadComfyConfig(env: NodeJS.ProcessEnv = process.env): ComfyConfig {
  return {
    enabled: (env.COMFYUI_ENABLED ?? "false").toLowerCase() === "true",
    baseUrl: env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
    timeoutMs: Number(env.COMFYUI_TIMEOUT_MS ?? 120_000)
  };
}

export function comfyStatusResponse(config: ComfyConfig) {
  return {
    enabled: config.enabled,
    baseUrlHostname: safeHostname(config.baseUrl),
    timeoutMs: config.timeoutMs
  };
}

export async function testComfyConnection(config: ComfyConfig = loadComfyConfig(), fetchImpl: ComfyHttp = fetch) {
  if (!config.enabled) return { status: "disabled", ...comfyStatusResponse(config), lastTestedAt: new Date().toISOString() };
  try {
    const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/system_stats`, { method: "GET" }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`ComfyUI health check failed: ${response.status}`);
    return { status: "ok", ...comfyStatusResponse(config), lastTestedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "error", ...comfyStatusResponse(config), lastTestedAt: new Date().toISOString(), sanitizedError: sanitizeLog(error instanceof Error ? error.message : String(error)) };
  }
}

export function listComfyWorkflows(db: Database.Database, projectId: string): ComfyWorkflowRow[] {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,workflow_type AS workflowType,name,version,status,is_active AS isActive,is_builtin AS isBuiltin,
    workflow_json AS workflowJson,mapping_json AS mappingJson,validation_json AS validationJson,deleted_at AS deletedAt,created_at AS createdAt,updated_at AS updatedAt
    FROM media_comfy_workflows WHERE media_project_id=? AND deleted_at IS NULL ORDER BY workflow_type,is_active DESC,version DESC,created_at DESC`).all(projectId) as ComfyWorkflowRow[];
}

export function importComfyWorkflow(db: Database.Database, projectId: string, input: {
  id: string;
  name: string;
  workflowType: ComfyWorkflowType;
  workflowJson: unknown;
  mapping: ComfyWorkflowMapping;
  activate?: boolean;
  now: string;
}, audit: MediaAuditWriter) {
  assertProjectExists(db, projectId);
  const validation = validateComfyWorkflow(input.workflowType, input.workflowJson, input.mapping);
  const version = nextWorkflowVersion(db, projectId, input.workflowType, input.name);
  if (input.activate && !validation.valid) throw new MediaStudioError("Only valid ComfyUI workflows can be activated", 400);
  if (input.activate) deactivateWorkflows(db, projectId, input.workflowType);
  db.prepare(`INSERT INTO media_comfy_workflows (id,media_project_id,workflow_type,name,version,status,is_active,is_builtin,workflow_json,mapping_json,validation_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, input.workflowType, input.name, version, validation.valid ? "VALID" : "INVALID", input.activate && validation.valid ? 1 : 0, 0, JSON.stringify(input.workflowJson), JSON.stringify(input.mapping), JSON.stringify(validation), input.now, input.now);
  audit("MEDIA_COMFY_WORKFLOW_IMPORTED", `ComfyUI workflow ${input.name} imported`, { projectId, payload: { workflowId: input.id, workflowType: input.workflowType, version, status: validation.valid ? "VALID" : "INVALID" } });
  if (input.activate && validation.valid) {
    audit("MEDIA_COMFY_WORKFLOW_ACTIVATED", `ComfyUI workflow ${input.name} activated`, { projectId, payload: { workflowId: input.id, workflowType: input.workflowType, version } });
  }
  return getComfyWorkflow(db, projectId, input.id);
}

export function updateComfyWorkflow(db: Database.Database, projectId: string, workflowId: string, input: {
  id: string;
  name: string;
  workflowJson: unknown;
  mapping: ComfyWorkflowMapping;
  activate?: boolean;
  now: string;
}, audit: MediaAuditWriter) {
  const previous = getComfyWorkflow(db, projectId, workflowId);
  const validation = validateComfyWorkflow(previous.workflowType, input.workflowJson, input.mapping);
  if (input.activate && !validation.valid) throw new MediaStudioError("Only valid ComfyUI workflows can be activated", 400);
  const version = nextWorkflowVersion(db, projectId, previous.workflowType, input.name);
  if (input.activate) deactivateWorkflows(db, projectId, previous.workflowType);
  db.prepare(`INSERT INTO media_comfy_workflows (id,media_project_id,workflow_type,name,version,status,is_active,is_builtin,workflow_json,mapping_json,validation_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, previous.workflowType, input.name, version, validation.valid ? "VALID" : "INVALID", input.activate && validation.valid ? 1 : 0, 0, JSON.stringify(input.workflowJson), JSON.stringify(input.mapping), JSON.stringify(validation), input.now, input.now);
  audit("MEDIA_COMFY_WORKFLOW_VERSIONED", `ComfyUI workflow ${input.name} saved as version ${version}`, { projectId, payload: { previousWorkflowId: workflowId, workflowId: input.id, workflowType: previous.workflowType, version, status: validation.valid ? "VALID" : "INVALID" } });
  if (input.activate && validation.valid) {
    audit("MEDIA_COMFY_WORKFLOW_ACTIVATED", `ComfyUI workflow ${input.name} activated`, { projectId, payload: { workflowId: input.id, workflowType: previous.workflowType, version } });
  }
  return getComfyWorkflow(db, projectId, input.id);
}

export function deleteComfyWorkflow(db: Database.Database, projectId: string, workflowId: string, timestamp: string, audit: MediaAuditWriter) {
  const workflow = getComfyWorkflow(db, projectId, workflowId);
  db.prepare("UPDATE media_comfy_workflows SET deleted_at=?,is_active=0,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, timestamp, workflowId, projectId);
  audit("MEDIA_COMFY_WORKFLOW_DELETED", `ComfyUI workflow ${workflow.name} deleted`, { projectId, payload: { workflowId, workflowType: workflow.workflowType, version: workflow.version } });
  return { deleted: true };
}

export function activateComfyWorkflow(db: Database.Database, projectId: string, workflowId: string, timestamp: string, audit: MediaAuditWriter) {
  const workflow = getComfyWorkflow(db, projectId, workflowId);
  if (workflow.isBuiltin) throw new MediaStudioError("Built-in placeholder workflows cannot be activated", 400);
  if (workflow.status !== "VALID") throw new MediaStudioError("Only valid ComfyUI workflows can be activated", 400);
  deactivateWorkflows(db, projectId, workflow.workflowType);
  db.prepare("UPDATE media_comfy_workflows SET is_active=1,updated_at=? WHERE id=? AND media_project_id=?").run(timestamp, workflowId, projectId);
  audit("MEDIA_COMFY_WORKFLOW_ACTIVATED", `ComfyUI workflow ${workflow.name} activated`, { projectId, payload: { workflowId, workflowType: workflow.workflowType, version: workflow.version } });
  return getComfyWorkflow(db, projectId, workflowId);
}

export function previewCompiledWorkflow(db: Database.Database, projectId: string, input: { sceneId: string; workflowId?: string; workflowType?: ComfyWorkflowType; fps?: number; seed?: number }) {
  const scene = getScene(db, projectId, input.sceneId);
  const workflow = input.workflowId ? getComfyWorkflow(db, projectId, input.workflowId) : getActiveComfyWorkflow(db, projectId, input.workflowType ?? "WAN_T2V");
  const compiled = compileWorkflow(workflow, scene, { fps: input.fps, seed: input.seed, inputImage: getPreviewImageName(db, projectId, scene.id) });
  return { workflow: toPublicWorkflow(workflow), compiledWorkflow: compiled.workflow, values: compiled.values };
}

export async function generateWanForScene(db: Database.Database, projectId: string, sceneId: string, input: {
  jobId: string;
  outputAssetId: string;
  now: string;
  mode: WanGenerationMode;
  approved: boolean;
  fps?: number;
  seed?: number;
  config?: ComfyConfig;
  fetchImpl?: ComfyHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
}, audit: MediaAuditWriter) {
  if (!input.approved) throw new MediaStudioError("Wan generation requires explicit approval", 403);
  const config = input.config ?? loadComfyConfig();
  if (!config.enabled) throw new MediaStudioError("ComfyUI provider is disabled", 409);
  const scene = getScene(db, projectId, sceneId);
  const fetchImpl = input.fetchImpl ?? fetch;
  const storageRoot = resolveStorageRoot(input.storageRoot);
  const workflowType = modeToWorkflowType(input.mode);
  const activeWorkflow = getActiveComfyWorkflow(db, projectId, workflowType);
  let uploadedImage: string | null = null;
  if (input.mode === "image-to-video") {
    const imageAsset = getSceneInputImage(db, projectId, sceneId);
    uploadedImage = await uploadInputImage(config, imageAsset, fetchImpl);
  }
  const compiled = compileWorkflow(activeWorkflow, scene, { fps: input.fps, seed: input.seed, inputImage: uploadedImage ?? undefined });
  insertGenerationJob(db, input.jobId, projectId, "wan-2.2", "QUEUED", { sceneId, mode: input.mode, workflowId: activeWorkflow.id, workflowVersion: activeWorkflow.version, values: compiled.values }, input.now);
  db.prepare("UPDATE media_scenes SET status='GENERATING',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
  updateGenerationJob(db, input.jobId, "RUNNING", input.now, "Starting ComfyUI Wan generation");
  audit("MEDIA_WAN_GENERATION_STARTED", `Wan generation started for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId, mode: input.mode } });

  try {
    const promptId = await submitWorkflow(config, compiled.workflow, fetchImpl);
    updateGenerationJob(db, input.jobId, "RUNNING", input.now, `Submitted ComfyUI prompt ${promptId}`);
    const output = await pollComfyOutput(config, promptId, fetchImpl);
    const bytes = await downloadComfyOutput(config, output, fetchImpl);
    const asset = await saveGeneratedVideoAsset(db, projectId, sceneId, {
      id: input.outputAssetId,
      jobId: input.jobId,
      originalName: output.filename,
      bytes,
      now: input.now,
      storageRoot,
      metadata: { promptId, uploadedImage, workflowId: activeWorkflow.id, workflowVersion: activeWorkflow.version, workflowType }
    });
    updateGenerationJob(db, input.jobId, "COMPLETED", input.now, `Generated ${output.filename}`, { promptId, output, assetId: asset.id });
    db.prepare("UPDATE media_scenes SET status='ASSET_READY',updated_at=? WHERE id=? AND media_project_id=?").run(input.now, sceneId, projectId);
    audit("MEDIA_WAN_GENERATION_COMPLETED", `Wan generation completed for scene ${scene.title}`, { projectId, payload: { sceneId, jobId: input.jobId, assetId: asset.id } });
    await processMediaAsset(db, projectId, asset.id, { jobId: `${input.jobId}-qc`, now: input.now, storageRoot, ...input.processOptions }, audit);
    return { job: getGenerationJob(db, input.jobId), asset: getAsset(db, projectId, asset.id) };
  } catch (error) {
    const message = sanitizeLog(error instanceof Error ? error.message : String(error));
    updateGenerationJob(db, input.jobId, "FAILED", input.now, message);
    audit("MEDIA_WAN_GENERATION_FAILED", message, { projectId, payload: { sceneId, jobId: input.jobId } });
    throw new MediaStudioError(message, 502);
  }
}

export async function cancelComfyGeneration(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter, config: ComfyConfig = loadComfyConfig(), fetchImpl: ComfyHttp = fetch) {
  const job = getGenerationJob(db, jobId);
  if (job.mediaProjectId !== projectId) throw new MediaStudioError("Generation job not found", 404);
  if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && config.enabled) {
    await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/interrupt`, { method: "POST" }, config.timeoutMs, fetchImpl).catch(() => undefined);
  }
  updateGenerationJob(db, jobId, "CANCELLED", timestamp, "Generation cancelled");
  audit("MEDIA_WAN_GENERATION_CANCELLED", "Wan generation cancelled", { projectId, payload: { jobId } });
  return getGenerationJob(db, jobId);
}

export async function retryComfyGeneration(db: Database.Database, projectId: string, jobId: string, input: { jobId: string; outputAssetId: string; now: string; approved: boolean; config?: ComfyConfig; fetchImpl?: ComfyHttp; storageRoot?: string; processOptions?: Partial<MediaProcessingOptions> }, audit: MediaAuditWriter) {
  const previous = getGenerationJob(db, jobId);
  const request = JSON.parse(previous.requestJson) as { sceneId: string; mode: WanGenerationMode; values?: { fps?: number; seed?: number } };
  return generateWanForScene(db, projectId, request.sceneId, { ...input, mode: request.mode, fps: request.values?.fps, seed: request.values?.seed }, audit);
}

async function uploadInputImage(config: ComfyConfig, asset: AssetRow, fetchImpl: ComfyHttp) {
  if (!asset.localPath) throw new Error("Input image has no local file");
  const form = new FormData();
  const bytes = await fs.readFile(asset.localPath);
  form.append("image", new Blob([new Uint8Array(bytes)], { type: asset.mimeType ?? "image/png" }), asset.fileName ?? asset.originalName ?? "input.png");
  const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/upload/image`, { method: "POST", body: form }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`ComfyUI image upload failed: ${response.status}`);
  const data = await response.json() as { name?: string };
  return data.name ?? asset.fileName ?? "input.png";
}

async function submitWorkflow(config: ComfyConfig, workflow: Record<string, unknown>, fetchImpl: ComfyHttp) {
  const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow })
  }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`ComfyUI workflow submit failed: ${response.status}`);
  const data = await response.json() as { prompt_id?: string };
  if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt id");
  return data.prompt_id;
}

async function pollComfyOutput(config: ComfyConfig, promptId: string, fetchImpl: ComfyHttp) {
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() <= deadline) {
    const response = await fetchWithTimeout(`${trimBaseUrl(config.baseUrl)}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, config.timeoutMs, fetchImpl);
    if (!response.ok) throw new Error(`ComfyUI history poll failed: ${response.status}`);
    const data = await response.json() as Record<string, { outputs?: Record<string, { videos?: ComfyOutput[] }> }>;
    const prompt = data[promptId];
    const output = Object.values(prompt?.outputs ?? {}).flatMap((node) => node.videos ?? [])[0];
    if (output) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("ComfyUI generation timed out");
}

async function downloadComfyOutput(config: ComfyConfig, output: ComfyOutput, fetchImpl: ComfyHttp) {
  const url = new URL(`${trimBaseUrl(config.baseUrl)}/view`);
  url.searchParams.set("filename", output.filename);
  if (output.subfolder) url.searchParams.set("subfolder", output.subfolder);
  if (output.type) url.searchParams.set("type", output.type);
  const response = await fetchWithTimeout(url.toString(), { method: "GET" }, config.timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`ComfyUI output download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function saveGeneratedVideoAsset(db: Database.Database, projectId: string, sceneId: string, input: { id: string; jobId: string; originalName: string; bytes: Buffer; now: string; storageRoot: string; metadata: unknown }) {
  const fileName = `${sanitizeSegment(input.id)}-wan.mp4`;
  const localPath = path.resolve(input.storageRoot, sanitizeSegment(projectId), sanitizeSegment(sceneId), fileName);
  assertInsideRoot(localPath, input.storageRoot);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.bytes);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, projectId, sceneId, "video", `Wan generated ${input.originalName}`, "comfyui-wan", "GENERATED", fileName, input.originalName, "video/mp4", input.bytes.length, checksum, localPath, JSON.stringify(input.metadata), input.now, input.now);
  return getAsset(db, projectId, input.id);
}

function insertGenerationJob(db: Database.Database, id: string, projectId: string, providerKey: string, status: ComfyJobStatus, request: unknown, timestamp: string) {
  db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, providerKey, status, JSON.stringify(request), null, timestamp, timestamp);
}

function updateGenerationJob(db: Database.Database, id: string, status: ComfyJobStatus, timestamp: string, logText: string, result: unknown = null) {
  db.prepare("UPDATE media_generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=?")
    .run(status, JSON.stringify({ log: sanitizeLog(logText), result }), timestamp, id);
}

function getGenerationJob(db: Database.Database, id: string) {
  const job = db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_generation_jobs WHERE id=?`).get(id) as { id: string; mediaProjectId: string; status: string; requestJson: string; resultJson: string | null } | undefined;
  if (!job) throw new MediaStudioError("Generation job not found", 404);
  return job;
}

function assertProjectExists(db: Database.Database, projectId: string): void {
  const project = db.prepare("SELECT id FROM media_projects WHERE id=?").get(projectId);
  if (!project) throw new MediaStudioError("Media project not found", 404);
}

function getComfyWorkflow(db: Database.Database, projectId: string, workflowId: string): ComfyWorkflowRow {
  const workflow = db.prepare(`SELECT id,media_project_id AS mediaProjectId,workflow_type AS workflowType,name,version,status,is_active AS isActive,is_builtin AS isBuiltin,
    workflow_json AS workflowJson,mapping_json AS mappingJson,validation_json AS validationJson,deleted_at AS deletedAt,created_at AS createdAt,updated_at AS updatedAt
    FROM media_comfy_workflows WHERE id=? AND media_project_id=? AND deleted_at IS NULL`).get(workflowId, projectId) as ComfyWorkflowRow | undefined;
  if (!workflow) throw new MediaStudioError("ComfyUI workflow not found", 404);
  return workflow;
}

function getActiveComfyWorkflow(db: Database.Database, projectId: string, workflowType: ComfyWorkflowType): ComfyWorkflowRow {
  const workflow = db.prepare(`SELECT id,media_project_id AS mediaProjectId,workflow_type AS workflowType,name,version,status,is_active AS isActive,is_builtin AS isBuiltin,
    workflow_json AS workflowJson,mapping_json AS mappingJson,validation_json AS validationJson,deleted_at AS deletedAt,created_at AS createdAt,updated_at AS updatedAt
    FROM media_comfy_workflows WHERE media_project_id=? AND workflow_type=? AND is_active=1 AND status='VALID' AND is_builtin=0 AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`).get(projectId, workflowType) as ComfyWorkflowRow | undefined;
  if (!workflow) throw new MediaStudioError(`No valid active ${workflowType} ComfyUI workflow is configured`, 409);
  return workflow;
}

function deactivateWorkflows(db: Database.Database, projectId: string, workflowType: ComfyWorkflowType): void {
  db.prepare("UPDATE media_comfy_workflows SET is_active=0 WHERE media_project_id=? AND workflow_type=?").run(projectId, workflowType);
}

function nextWorkflowVersion(db: Database.Database, projectId: string, workflowType: ComfyWorkflowType, name: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(version),0) + 1 AS version FROM media_comfy_workflows WHERE media_project_id=? AND workflow_type=? AND name=?")
    .get(projectId, workflowType, name) as { version: number };
  return row.version;
}

export function validateComfyWorkflow(workflowType: ComfyWorkflowType, workflowJson: unknown, mapping: ComfyWorkflowMapping): ComfyWorkflowValidation {
  const issues: ComfyWorkflowValidation["issues"] = [];
  if (!isRecord(workflowJson)) {
    issues.push({ code: "INVALID_JSON", message: "Workflow JSON must be an object keyed by ComfyUI node id." });
    return { valid: false, issues };
  }
  const outputNode = workflowJson[mapping.outputNodeId];
  if (!isComfyNode(outputNode)) {
    issues.push({ code: "MISSING_OUTPUT_NODE", message: `Output node ${mapping.outputNodeId} is missing or invalid.` });
  } else if (!isOutputNode(outputNode)) {
    issues.push({ code: "INVALID_OUTPUT_NODE", message: `Output node ${mapping.outputNodeId} must be a save, output, or video node.` });
  }
  const requiredMappings: Array<[keyof ComfyWorkflowMapping, string | undefined]> = [
    ["prompt", mapping.prompt],
    ["width", mapping.width],
    ["height", mapping.height],
    ["frames", mapping.frames],
    ["fps", mapping.fps],
    ["seed", mapping.seed]
  ];
  if (workflowType === "WAN_I2V") requiredMappings.push(["image", mapping.image]);
  for (const [key, value] of requiredMappings) {
    if (!value) {
      issues.push({ code: "MISSING_MAPPING", message: `${String(key)} mapping is required.` });
      continue;
    }
    if (!pathExists(workflowJson, value)) {
      issues.push({ code: "MISSING_MAPPING_TARGET", message: `${String(key)} mapping target ${value} does not exist.` });
    }
  }
  return { valid: issues.length === 0, issues };
}

function compileWorkflow(workflow: ComfyWorkflowRow, scene: SceneRow, input: { fps?: number; seed?: number; inputImage?: string }) {
  if (workflow.status !== "VALID" || workflow.isBuiltin || workflow.deletedAt) throw new MediaStudioError("ComfyUI workflow is not valid for generation", 409);
  const workflowJson = JSON.parse(workflow.workflowJson) as Record<string, unknown>;
  const mapping = JSON.parse(workflow.mappingJson) as ComfyWorkflowMapping;
  const compiled = structuredClone(workflowJson);
  const dimensions = dimensionsForAspectRatio(scene.aspectRatio);
  const fps = input.fps ?? 24;
  const seed = input.seed ?? 1;
  const values = {
    prompt: scene.visualPrompt,
    image: input.inputImage,
    width: dimensions.width,
    height: dimensions.height,
    frames: Math.max(1, scene.durationSeconds * fps),
    fps,
    seed
  };
  setMappedValue(compiled, mapping.prompt, values.prompt);
  setMappedValue(compiled, mapping.width, values.width);
  setMappedValue(compiled, mapping.height, values.height);
  setMappedValue(compiled, mapping.frames, values.frames);
  setMappedValue(compiled, mapping.fps, values.fps);
  setMappedValue(compiled, mapping.seed, values.seed);
  if (mapping.image) setMappedValue(compiled, mapping.image, values.image ?? "{{uploaded_image}}");
  return { workflow: compiled, values };
}

function getPreviewImageName(db: Database.Database, projectId: string, sceneId: string): string | undefined {
  const asset = db.prepare(`SELECT file_name AS fileName,original_name AS originalName FROM media_assets
    WHERE media_project_id=? AND scene_id=? AND kind='image' AND local_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(projectId, sceneId) as { fileName: string | null; originalName: string | null } | undefined;
  return asset?.fileName ?? asset?.originalName ?? undefined;
}

function toPublicWorkflow(workflow: ComfyWorkflowRow) {
  return {
    id: workflow.id,
    mediaProjectId: workflow.mediaProjectId,
    workflowType: workflow.workflowType,
    name: workflow.name,
    version: workflow.version,
    status: workflow.status,
    isActive: Boolean(workflow.isActive),
    isBuiltin: Boolean(workflow.isBuiltin),
    validation: JSON.parse(workflow.validationJson) as ComfyWorkflowValidation,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt
  };
}

function pathExists(root: Record<string, unknown>, pathValue: string): boolean {
  const parts = pathValue.split(".").filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function setMappedValue(root: Record<string, unknown>, pathValue: string, value: unknown): void {
  const parts = pathValue.split(".").filter(Boolean);
  if (!parts.length) throw new MediaStudioError("Invalid workflow mapping path", 400);
  let current: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current) || !(part in current)) throw new MediaStudioError(`Workflow mapping target ${pathValue} does not exist`, 400);
    current = current[part];
  }
  if (!isRecord(current)) throw new MediaStudioError(`Workflow mapping target ${pathValue} does not exist`, 400);
  current[parts[parts.length - 1]] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComfyNode(value: unknown): value is { class_type: string; inputs?: Record<string, unknown> } {
  return isRecord(value) && typeof value.class_type === "string" && (!("inputs" in value) || isRecord(value.inputs));
}

function isOutputNode(value: { class_type: string }) {
  return /save|output|video/i.test(value.class_type);
}

function modeToWorkflowType(mode: WanGenerationMode): ComfyWorkflowType {
  return mode === "image-to-video" ? "WAN_I2V" : "WAN_T2V";
}

function dimensionsForAspectRatio(aspectRatio: string) {
  switch (aspectRatio) {
    case "9:16": return { width: 1080, height: 1920 };
    case "1:1": return { width: 1080, height: 1080 };
    case "4:3": return { width: 1440, height: 1080 };
    case "3:4": return { width: 1080, height: 1440 };
    case "21:9": return { width: 2560, height: 1080 };
    default: return { width: 1920, height: 1080 };
  }
}

type ComfyWorkflowRow = {
  id: string;
  mediaProjectId: string;
  workflowType: ComfyWorkflowType;
  name: string;
  version: number;
  status: "VALID" | "INVALID";
  isActive: 0 | 1;
  isBuiltin: 0 | 1;
  workflowJson: string;
  mappingJson: string;
  validationJson: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SceneRow = { id: string; title: string; visualPrompt: string; durationSeconds: number; aspectRatio: string };
type AssetRow = { id: string; fileName: string | null; originalName: string | null; mimeType: string | null; localPath: string | null };
type StoredAssetRow = AssetRow & {
  source: string;
  status: string;
  sizeBytes: number | null;
  checksumSha256: string | null;
};
type ComfyOutput = { filename: string; subfolder?: string; type?: string };

function getScene(db: Database.Database, projectId: string, sceneId: string): SceneRow {
  const scene = db.prepare("SELECT id,title,visual_prompt AS visualPrompt,duration_seconds AS durationSeconds,aspect_ratio AS aspectRatio FROM media_scenes WHERE id=? AND media_project_id=?").get(sceneId, projectId) as SceneRow | undefined;
  if (!scene) throw new MediaStudioError("Media scene not found", 404);
  return scene;
}

function getSceneInputImage(db: Database.Database, projectId: string, sceneId: string): AssetRow {
  const asset = db.prepare(`SELECT id,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,local_path AS localPath FROM media_assets
    WHERE media_project_id=? AND scene_id=? AND kind='image' AND local_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(projectId, sceneId) as AssetRow | undefined;
  if (!asset) throw new MediaStudioError("Image-to-video requires an uploaded scene image", 409);
  return asset;
}

function getAsset(db: Database.Database, projectId: string, assetId: string): StoredAssetRow {
  const asset = db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,source,status,file_name AS fileName,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksumSha256,local_path AS localPath,inspection_json AS inspectionJson,qc_status AS qcStatus,qc_issues_json AS qcIssuesJson,preview_path AS previewPath,thumbnail_path AS thumbnailPath,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_assets WHERE media_project_id=? AND id=?`).get(projectId, assetId) as StoredAssetRow | undefined;
  if (!asset) throw new MediaStudioError("Media asset not found", 404);
  return asset;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetchImpl: ComfyHttp) {
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
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaStudioError("ComfyUI output path escapes storage root", 400);
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
