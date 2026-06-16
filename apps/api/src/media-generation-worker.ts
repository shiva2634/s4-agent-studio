import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { MediaStudioError, ensurePromptVersionForScene, getPromptVersion, sanitizeRegenerationReason, validateGenerationReferences, type MediaAuditWriter } from "./media-studio.js";
import { routeMediaGeneration, type MediaProviderTask, type ProviderKey } from "./media-provider-router.js";
import { recordGenerationStatusHistory, sanitizeHistoryMessage } from "./media-generation-history.js";
import { loadComfyConfig, type ComfyConfig, type ComfyHttp } from "./comfyui-provider.js";
import { loadLongCatConfig, type LongCatConfig, type LongCatHttp } from "./longcat-provider.js";
import { loadLtxConfig, loadOviConfig, type ExternalMediaConfig, type ExternalMediaHttp } from "./ovi-ltx-provider.js";
import type { MediaProcessingOptions } from "./media-processing.js";

export type GenerationWorkerConfig = {
  concurrency: number;
  pollingIntervalMs: number;
  maxProcessingMs: number;
};

export type EnqueueGenerationInput = {
  projectId: string;
  sceneId: string;
  task: MediaProviderTask;
  providerKey?: ProviderKey;
  approved: boolean;
  paidProviderApproved?: boolean;
  maxAttempts?: number;
  fps?: number;
  seed?: number;
  promptVersionId?: string;
  referenceAssetIds?: string[];
  regenerationReason?: string;
  now: string;
  jobId?: string;
  outputAssetId?: string;
};

type WorkerDeps = {
  comfyConfig?: ComfyConfig;
  comfyFetch?: ComfyHttp;
  longCatConfig?: LongCatConfig;
  longCatFetch?: LongCatHttp;
  oviConfig?: ExternalMediaConfig;
  oviFetch?: ExternalMediaHttp;
  ltxConfig?: ExternalMediaConfig;
  ltxFetch?: ExternalMediaHttp;
  storageRoot?: string;
  processOptions?: Partial<MediaProcessingOptions>;
};

type QueuedJob = { id: string; queuedAt: number };
type JobRow = { id: string; mediaProjectId: string; providerKey: string; status: string; requestJson: string; resultJson: string | null; createdAt: string; updatedAt: string };

const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "WAITING_FOR_USER", "IMPORTED"]);

export function loadGenerationWorkerConfig(env: NodeJS.ProcessEnv = process.env): GenerationWorkerConfig {
  return {
    concurrency: parsePositiveInt(env.S4_MEDIA_GENERATION_WORKER_CONCURRENCY, 2),
    pollingIntervalMs: parsePositiveInt(env.S4_MEDIA_GENERATION_POLL_INTERVAL_MS, 1_000),
    maxProcessingMs: parsePositiveInt(env.S4_MEDIA_GENERATION_MAX_PROCESSING_MS, 10 * 60_000)
  };
}

export class MediaGenerationWorker {
  private readonly queue: QueuedJob[] = [];
  private readonly active = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private running = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly audit: MediaAuditWriter,
    private readonly config: GenerationWorkerConfig = loadGenerationWorkerConfig(),
    private readonly deps: WorkerDeps = {}
  ) {}

  enqueue(jobId: string): void {
    if (this.active.has(jobId) || this.queue.some((job) => job.id === jobId)) return;
    this.queue.push({ id: jobId, queuedAt: Date.now() });
    queueMicrotask(() => this.drain());
  }

  enqueueGeneration(input: EnqueueGenerationInput) {
    if (!input.approved) throw new MediaStudioError("Media generation requires explicit approval", 403);
    assertSceneExists(this.db, input.projectId, input.sceneId);
    const jobId = input.jobId ?? nanoid();
    const outputAssetId = input.outputAssetId ?? nanoid();
    const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])];
    validateGenerationReferences(this.db, input.projectId, input.task, referenceAssetIds, input.providerKey);
    const reason = sanitizeRegenerationReason(input.regenerationReason);
    const previousPromptVersion = input.promptVersionId ? getPromptVersion(this.db, input.projectId, input.sceneId, input.promptVersionId) : null;
    const promptVersion = previousPromptVersion && !referenceAssetIds.length && !reason
      ? previousPromptVersion
      : ensurePromptVersionForScene(this.db, input.projectId, input.sceneId, {
        providerKey: input.providerKey ?? "router",
        taskType: input.task,
        positivePrompt: previousPromptVersion?.positivePrompt,
        settings: { fps: input.fps, seed: input.seed, maxAttempts: input.maxAttempts, regenerationReason: reason },
        referenceAssetIds,
        now: input.now,
        createdBy: "local-user"
      });
    const request = {
      sceneId: input.sceneId,
      task: input.task,
      providerKey: input.providerKey,
      approved: input.approved,
      paidProviderApproved: input.paidProviderApproved,
      maxAttempts: input.maxAttempts,
      fps: input.fps,
      seed: input.seed,
      outputAssetId,
      sceneVersionId: promptVersion.sceneVersionId || undefined,
      promptVersionId: promptVersion.id || undefined,
      referenceAssetIds,
      regenerationReason: reason ?? undefined
    };
    this.db.prepare(`INSERT INTO media_generation_jobs (id,media_project_id,provider_key,status,request_json,result_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(jobId, input.projectId, input.providerKey ?? "router", "QUEUED", JSON.stringify(request), null, input.now, input.now);
    updateGenerationJobVersionLinks(this.db, jobId, promptVersion.sceneVersionId || null, promptVersion.id || null);
    recordGenerationStatusHistory(this.db, { generationJobId: jobId, status: "QUEUED", createdAt: input.now, message: "Generation job queued", providerStatus: input.providerKey ?? "router" });
    this.enqueue(jobId);
    return getGenerationJob(this.db, input.projectId, jobId);
  }

  cancel(projectId: string, jobId: string, timestamp: string) {
    const job = getGenerationJob(this.db, projectId, jobId);
    if (terminalStatuses.has(job.status)) return job;
    this.queue.splice(0, this.queue.length, ...this.queue.filter((queued) => queued.id !== jobId));
    this.controllers.get(jobId)?.abort();
    updateJobStatus(this.db, jobId, "CANCELLED", timestamp, "Generation cancelled");
    this.audit("MEDIA_GENERATION_CANCELLED", "Generation job cancelled", { projectId, payload: { jobId } });
    return getGenerationJob(this.db, projectId, jobId);
  }

  retry(projectId: string, jobId: string, input: { jobId?: string; now: string; approved: boolean }) {
    const previous = getGenerationJob(this.db, projectId, jobId);
    if (!["FAILED", "CANCELLED"].includes(previous.status)) throw new MediaStudioError("Generation job cannot be retried from this state", 409);
    const request = parseRequest(previous.requestJson);
    recordGenerationStatusHistory(this.db, { generationJobId: jobId, status: "RETRIED", createdAt: input.now, message: `Retry requested as ${input.jobId ?? "new job"}` });
    return this.enqueueGeneration({
      projectId,
      sceneId: request.sceneId,
      task: request.task,
      providerKey: request.providerKey,
      approved: input.approved,
      paidProviderApproved: request.paidProviderApproved,
      maxAttempts: request.maxAttempts,
      fps: request.fps,
      seed: request.seed,
      promptVersionId: request.promptVersionId,
      referenceAssetIds: request.referenceAssetIds,
      regenerationReason: request.regenerationReason,
      now: input.now,
      jobId: input.jobId
    });
  }

  recoverStartup(timestamp: string) {
    const stuck = this.db.prepare(`SELECT id,media_project_id AS mediaProjectId,status FROM media_generation_jobs
      WHERE status IN ('QUEUED','ROUTING','SUBMITTED','PROCESSING')`).all() as Array<{ id: string; mediaProjectId: string; status: string }>;
    for (const job of stuck) {
      if (job.status === "QUEUED") {
        recordGenerationStatusHistory(this.db, { generationJobId: job.id, status: "QUEUED", createdAt: timestamp, message: "Generation job recovered on startup" });
        this.enqueue(job.id);
      } else {
        updateJobStatus(this.db, job.id, "FAILED", timestamp, "Generation interrupted by API restart");
        this.audit("MEDIA_GENERATION_RECOVERY_FAILED", "Generation job marked failed after restart", { projectId: job.mediaProjectId, payload: { jobId: job.id, previousStatus: job.status } });
      }
    }
  }

  private drain(): void {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const queued = this.queue.shift() as QueuedJob;
      if (this.active.has(queued.id)) continue;
      this.running += 1;
      this.active.add(queued.id);
      void this.runJob(queued.id).finally(() => {
        this.controllers.delete(queued.id);
        this.active.delete(queued.id);
        this.running -= 1;
        this.drain();
      });
    }
  }

  private async runJob(jobId: string) {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const startedAt = Date.now();
    const job = getGenerationJobById(this.db, jobId);
    if (!job || terminalStatuses.has(job.status)) return;
    const request = parseRequest(job.requestJson);
    const isCancelled = () => controller.signal.aborted || getGenerationJobById(this.db, jobId)?.status === "CANCELLED";
    if (isCancelled()) return;
    try {
      updateJobStatus(this.db, jobId, "ROUTING", new Date().toISOString(), "Generation routing started");
      await routeMediaGeneration(this.db, job.mediaProjectId, request.sceneId, {
        jobId,
        outputAssetId: request.outputAssetId,
        now: new Date().toISOString(),
        task: request.task,
        providerKey: request.providerKey,
        approved: request.approved,
        paidProviderApproved: request.paidProviderApproved,
        maxAttempts: request.maxAttempts,
        fps: request.fps,
        seed: request.seed,
        promptVersionId: request.promptVersionId,
        sceneVersionId: request.sceneVersionId,
        referenceAssetIds: request.referenceAssetIds,
        regenerationReason: request.regenerationReason,
        config: this.deps.comfyConfig ?? loadComfyConfig(),
        fetchImpl: this.deps.comfyFetch,
        longCatConfig: this.deps.longCatConfig ?? loadLongCatConfig(),
        longCatFetchImpl: this.deps.longCatFetch,
        oviConfig: this.deps.oviConfig ?? loadOviConfig(),
        oviFetchImpl: this.deps.oviFetch,
        ltxConfig: this.deps.ltxConfig ?? loadLtxConfig(),
        ltxFetchImpl: this.deps.ltxFetch,
        storageRoot: this.deps.storageRoot,
        processOptions: this.deps.processOptions,
        shouldCancel: () => isCancelled() || Date.now() - startedAt > this.config.maxProcessingMs,
        pollingIntervalMs: this.config.pollingIntervalMs
      }, this.audit);
      if (isCancelled()) return;
    } catch (error) {
      if (isCancelled()) return;
      const message = sanitizeHistoryMessage(error instanceof Error ? error.message : String(error));
      updateJobStatus(this.db, jobId, "FAILED", new Date().toISOString(), message);
      this.audit("MEDIA_GENERATION_FAILED", message, { projectId: job.mediaProjectId, payload: { jobId } });
    }
  }
}

export function getGenerationJob(db: Database.Database, projectId: string, jobId: string): JobRow {
  const job = db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_generation_jobs WHERE id=? AND media_project_id=?`).get(jobId, projectId) as JobRow | undefined;
  if (!job) throw new MediaStudioError("Generation job not found", 404);
  return job;
}

function getGenerationJobById(db: Database.Database, jobId: string): JobRow | undefined {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,provider_key AS providerKey,status,request_json AS requestJson,result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM media_generation_jobs WHERE id=?`).get(jobId) as JobRow | undefined;
}

function updateJobStatus(db: Database.Database, jobId: string, status: string, timestamp: string, message: string) {
  const current = getGenerationJobById(db, jobId);
  if (!current || terminalStatuses.has(current.status)) return;
  const result = current.resultJson ? safeJson(current.resultJson) : {};
  db.prepare("UPDATE media_generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=? AND status!='CANCELLED'")
    .run(status, JSON.stringify({ ...result, log: sanitizeHistoryMessage(message) }), timestamp, jobId);
  recordGenerationStatusHistory(db, { generationJobId: jobId, status, createdAt: timestamp, message });
}

function parseRequest(value: string) {
  const parsed = safeJson(value);
  if (typeof parsed.sceneId !== "string") throw new MediaStudioError("Generation job request is missing scene id", 400);
  if (!["T2V", "I2V", "PRESENTER", "AUDIO_VIDEO"].includes(String(parsed.task))) throw new MediaStudioError("Generation job request has invalid task", 400);
  return parsed as {
    sceneId: string;
    task: MediaProviderTask;
    providerKey?: ProviderKey;
    approved: boolean;
    paidProviderApproved?: boolean;
    maxAttempts?: number;
    fps?: number;
    seed?: number;
    outputAssetId: string;
    sceneVersionId?: string;
    promptVersionId?: string;
    referenceAssetIds?: string[];
    regenerationReason?: string;
  };
}

function updateGenerationJobVersionLinks(db: Database.Database, jobId: string, sceneVersionId: string | null, promptVersionId: string | null) {
  const columns = db.prepare("PRAGMA table_info(media_generation_jobs)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "prompt_version_id")) return;
  db.prepare("UPDATE media_generation_jobs SET scene_version_id=?,prompt_version_id=? WHERE id=?").run(sceneVersionId, promptVersionId, jobId);
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function assertSceneExists(db: Database.Database, projectId: string, sceneId: string) {
  const scene = db.prepare("SELECT id FROM media_scenes WHERE id=? AND media_project_id=?").get(sceneId, projectId);
  if (!scene) throw new MediaStudioError("Media scene not found", 404);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
