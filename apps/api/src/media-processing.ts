import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";

const execFileAsync = promisify(execFile);

export type ProcessingJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type QcStatus = "PENDING" | "PASSED" | "ISSUES" | "FAILED" | "SKIPPED";

export type MediaInspection = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
};

export type QcIssue = {
  code: "UNREADABLE_FILE" | "WRONG_ASPECT_RATIO" | "MISSING_AUDIO" | "DURATION_MISMATCH" | "LOW_RESOLUTION";
  message: string;
  severity: "warning" | "error";
};

export type ProcessResult = {
  jobId: string;
  status: ProcessingJobStatus;
  ffmpegAvailable: boolean;
  inspection: MediaInspection | null;
  qcStatus: QcStatus;
  qcIssues: QcIssue[];
  thumbnailPath: string | null;
  previewPath: string | null;
};

export type ProcessRunner = (command: string, args: string[], options: { timeoutMs: number; cwd?: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type MediaProcessingOptions = {
  jobId: string;
  now: string;
  storageRoot?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  runner?: ProcessRunner;
};

const defaultTimeoutMs = 30_000;

export async function detectFfmpeg(options: { ffmpegPath?: string; ffprobePath?: string; timeoutMs?: number; runner?: ProcessRunner } = {}) {
  const runner = options.runner ?? runProcess;
  const ffmpegPath = options.ffmpegPath ?? process.env.S4_FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.S4_FFPROBE_PATH ?? "ffprobe";
  const timeoutMs = options.timeoutMs ?? 5_000;
  const ffmpeg = await detectBinary(ffmpegPath, runner, timeoutMs);
  const ffprobe = await detectBinary(ffprobePath, runner, timeoutMs);
  return {
    available: ffmpeg.available && ffprobe.available,
    ffmpegPath,
    ffprobePath,
    ffmpeg,
    ffprobe
  };
}

export async function processMediaAsset(db: Database.Database, projectId: string, assetId: string, options: MediaProcessingOptions, audit: MediaAuditWriter): Promise<ProcessResult> {
  const asset = getAsset(db, projectId, assetId);
  if (!asset.localPath) throw new MediaStudioError("Media asset has no uploaded file", 404);
  assertInsideRoot(asset.localPath, resolveStorageRoot(options.storageRoot));
  insertProcessingJob(db, options.jobId, projectId, assetId, "QUEUED", options.now);
  setProcessingJobStatus(db, options.jobId, "RUNNING", options.now);
  audit("MEDIA_PROCESSING_STARTED", `Processing started for ${asset.originalName ?? asset.label}`, { projectId, payload: { assetId, jobId: options.jobId } });

  const log: string[] = [];
  try {
    const detection = await detectFfmpeg(options);
    log.push(`ffmpeg: ${detection.ffmpeg.available ? "available" : "unavailable"}`);
    log.push(`ffprobe: ${detection.ffprobe.available ? "available" : "unavailable"}`);
    if (!detection.available) {
      const message = "FFmpeg or FFprobe is unavailable";
      setProcessingJobFailed(db, options.jobId, options.now, message, log.join("\n"));
      db.prepare("UPDATE media_assets SET qc_status='SKIPPED',qc_issues_json=?,updated_at=? WHERE id=? AND media_project_id=?")
        .run(JSON.stringify([]), options.now, assetId, projectId);
      audit("MEDIA_PROCESSING_SKIPPED", message, { projectId, payload: { assetId, jobId: options.jobId, detection } });
      return { jobId: options.jobId, status: "FAILED", ffmpegAvailable: false, inspection: null, qcStatus: "SKIPPED", qcIssues: [], thumbnailPath: null, previewPath: null };
    }

    const inspection = await inspectMediaFile(asset.localPath, detection.ffprobePath, options.runner ?? runProcess, options.timeoutMs ?? defaultTimeoutMs);
    const scene = asset.sceneId ? getScene(db, projectId, asset.sceneId) : null;
    const qcIssues = buildQcIssues(inspection, scene, asset.kind);
    const qcStatus: QcStatus = qcIssues.some((issue) => issue.severity === "error") ? "FAILED" : qcIssues.length ? "ISSUES" : "PASSED";
    const derivatives = await generateDerivatives(asset, detection.ffmpegPath, options.runner ?? runProcess, options.timeoutMs ?? defaultTimeoutMs, resolveStorageRoot(options.storageRoot));
    db.prepare(`UPDATE media_assets SET inspection_json=?,qc_status=?,qc_issues_json=?,preview_path=?,thumbnail_path=?,updated_at=? WHERE id=? AND media_project_id=?`)
      .run(JSON.stringify(inspection), qcStatus, JSON.stringify(qcIssues), derivatives.previewPath, derivatives.thumbnailPath, options.now, assetId, projectId);
    setProcessingJobCompleted(db, options.jobId, options.now, log.join("\n"));
    audit("MEDIA_PROCESSING_COMPLETED", `Processing completed for ${asset.originalName ?? asset.label}`, {
      projectId,
      payload: { assetId, jobId: options.jobId, qcStatus, qcIssues, inspection, previewPath: derivatives.previewPath, thumbnailPath: derivatives.thumbnailPath }
    });
    return { jobId: options.jobId, status: "COMPLETED", ffmpegAvailable: true, inspection, qcStatus, qcIssues, previewPath: derivatives.previewPath, thumbnailPath: derivatives.thumbnailPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media processing failed";
    setProcessingJobFailed(db, options.jobId, options.now, message, log.join("\n"));
    const issues: QcIssue[] = [{ code: "UNREADABLE_FILE", message: "FFprobe could not read this file.", severity: "error" }];
    db.prepare("UPDATE media_assets SET qc_status='FAILED',qc_issues_json=?,updated_at=? WHERE id=? AND media_project_id=?")
      .run(JSON.stringify(issues), options.now, assetId, projectId);
    audit("MEDIA_PROCESSING_FAILED", message, { projectId, payload: { assetId, jobId: options.jobId } });
    return { jobId: options.jobId, status: "FAILED", ffmpegAvailable: true, inspection: null, qcStatus: "FAILED", qcIssues: issues, thumbnailPath: null, previewPath: null };
  }
}

export function listProcessingJobs(db: Database.Database, projectId: string) {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,asset_id AS assetId,status,operation,log_text AS logText,error,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM media_processing_jobs WHERE media_project_id=? ORDER BY created_at DESC`).all(projectId);
}

export function getMediaDerivativeForDownload(db: Database.Database, projectId: string, assetId: string, derivative: "thumbnail" | "preview", storageRoot?: string) {
  const column = derivative === "thumbnail" ? "thumbnail_path" : "preview_path";
  const asset = db.prepare(`SELECT id,mime_type AS mimeType,${column} AS localPath FROM media_assets WHERE id=? AND media_project_id=?`).get(assetId, projectId) as { id: string; mimeType: string | null; localPath: string | null } | undefined;
  if (!asset?.localPath) throw new MediaStudioError("Media derivative not found", 404);
  assertInsideRoot(asset.localPath, resolveStorageRoot(storageRoot));
  return {
    localPath: asset.localPath,
    mimeType: derivative === "thumbnail" ? "image/jpeg" : "video/mp4"
  };
}

async function detectBinary(command: string, runner: ProcessRunner, timeoutMs: number) {
  try {
    const result = await runner(command, ["-version"], { timeoutMs });
    return { available: result.exitCode === 0, output: sanitizeLog(`${result.stdout}${result.stderr}`) };
  } catch (error) {
    return { available: false, output: sanitizeLog(error instanceof Error ? error.message : "unavailable") };
  }
}

async function inspectMediaFile(localPath: string, ffprobePath: string, runner: ProcessRunner, timeoutMs: number): Promise<MediaInspection> {
  const result = await runner(ffprobePath, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", localPath], { timeoutMs });
  if (result.exitCode !== 0) throw new Error(sanitizeLog(result.stderr || "ffprobe failed"));
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFps(video?.avg_frame_rate ?? video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video)
  };
}

async function generateDerivatives(asset: AssetRow, ffmpegPath: string, runner: ProcessRunner, timeoutMs: number, storageRoot: string) {
  if (!asset.localPath) return { previewPath: null, thumbnailPath: null };
  const derivativeDir = path.resolve(storageRoot, "derivatives", sanitizeSegment(asset.mediaProjectId), sanitizeSegment(asset.id));
  assertInsideRoot(derivativeDir, storageRoot);
  await fs.mkdir(derivativeDir, { recursive: true });
  let previewPath: string | null = null;
  let thumbnailPath: string | null = null;
  if (asset.kind === "video") {
    thumbnailPath = path.join(derivativeDir, "thumbnail.jpg");
    previewPath = path.join(derivativeDir, "preview.mp4");
    await runner(ffmpegPath, ["-y", "-i", asset.localPath, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", thumbnailPath], { timeoutMs });
    await runner(ffmpegPath, ["-y", "-i", asset.localPath, "-vf", "scale='min(960,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", previewPath], { timeoutMs });
  } else if (asset.kind === "image") {
    thumbnailPath = path.join(derivativeDir, "thumbnail.jpg");
    await runner(ffmpegPath, ["-y", "-i", asset.localPath, "-vf", "scale='min(640,iw)':-2", "-frames:v", "1", thumbnailPath], { timeoutMs });
  }
  return { previewPath, thumbnailPath };
}

function buildQcIssues(inspection: MediaInspection, scene: SceneRow | null, kind: string): QcIssue[] {
  const issues: QcIssue[] = [];
  if (!inspection.hasVideo && kind === "video") issues.push({ code: "UNREADABLE_FILE", message: "No readable video stream was found.", severity: "error" });
  if (kind === "video" && !inspection.hasAudio) issues.push({ code: "MISSING_AUDIO", message: "Uploaded video has no audio stream.", severity: "warning" });
  if (scene?.durationSeconds && inspection.durationSeconds !== null && Math.abs(inspection.durationSeconds - scene.durationSeconds) > 1.5) {
    issues.push({ code: "DURATION_MISMATCH", message: `Duration ${inspection.durationSeconds.toFixed(2)}s does not match scene duration ${scene.durationSeconds}s.`, severity: "warning" });
  }
  if (scene?.aspectRatio && inspection.width && inspection.height && !matchesAspectRatio(inspection.width, inspection.height, scene.aspectRatio)) {
    issues.push({ code: "WRONG_ASPECT_RATIO", message: `Resolution ${inspection.width}x${inspection.height} does not match ${scene.aspectRatio}.`, severity: "warning" });
  }
  if (inspection.width && inspection.height && (inspection.width < 1280 || inspection.height < 720)) {
    issues.push({ code: "LOW_RESOLUTION", message: `Resolution ${inspection.width}x${inspection.height} is below 1280x720.`, severity: "warning" });
  }
  return issues;
}

function matchesAspectRatio(width: number, height: number, expected: string) {
  const [w, h] = expected.split(":").map(Number);
  if (!w || !h) return true;
  const actualRatio = width / height;
  const expectedRatio = w / h;
  return Math.abs(actualRatio - expectedRatio) / expectedRatio <= 0.03;
}

function parseFps(value: string | undefined): number | null {
  if (!value || value === "0/0") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator)) return null;
  if (!denominator) return numerator;
  return Number((numerator / denominator).toFixed(3));
}

async function runProcess(command: string, args: string[], options: { timeoutMs: number; cwd?: string }) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 2_000_000,
      windowsHide: true
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string; code?: number | string; signal?: string };
    return {
      stdout: maybe.stdout ?? "",
      stderr: `${maybe.stderr ?? ""}${maybe.signal ? `\nSignal: ${maybe.signal}` : ""}`,
      exitCode: typeof maybe.code === "number" ? maybe.code : 1
    };
  }
}

type AssetRow = {
  id: string;
  mediaProjectId: string;
  sceneId: string | null;
  kind: string;
  label: string;
  originalName: string | null;
  localPath: string | null;
};

type SceneRow = {
  durationSeconds: number;
  aspectRatio: string;
};

function getAsset(db: Database.Database, projectId: string, assetId: string): AssetRow {
  const asset = db.prepare(`SELECT id,media_project_id AS mediaProjectId,scene_id AS sceneId,kind,label,original_name AS originalName,local_path AS localPath
    FROM media_assets WHERE id=? AND media_project_id=?`).get(assetId, projectId) as AssetRow | undefined;
  if (!asset) throw new MediaStudioError("Media asset not found", 404);
  return asset;
}

function getScene(db: Database.Database, projectId: string, sceneId: string): SceneRow | null {
  return db.prepare("SELECT duration_seconds AS durationSeconds,aspect_ratio AS aspectRatio FROM media_scenes WHERE id=? AND media_project_id=?").get(sceneId, projectId) as SceneRow | undefined ?? null;
}

function insertProcessingJob(db: Database.Database, id: string, projectId: string, assetId: string, status: ProcessingJobStatus, timestamp: string) {
  db.prepare(`INSERT INTO media_processing_jobs (id,media_project_id,asset_id,status,operation,log_text,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, assetId, status, "INSPECT_AND_PROXY", "", timestamp, timestamp);
}

function setProcessingJobStatus(db: Database.Database, id: string, status: ProcessingJobStatus, timestamp: string) {
  db.prepare("UPDATE media_processing_jobs SET status=?,updated_at=? WHERE id=?").run(status, timestamp, id);
}

function setProcessingJobCompleted(db: Database.Database, id: string, timestamp: string, logText: string) {
  db.prepare("UPDATE media_processing_jobs SET status='COMPLETED',log_text=?,updated_at=?,completed_at=? WHERE id=?").run(sanitizeLog(logText), timestamp, timestamp, id);
}

function setProcessingJobFailed(db: Database.Database, id: string, timestamp: string, error: string, logText: string) {
  db.prepare("UPDATE media_processing_jobs SET status='FAILED',error=?,log_text=?,updated_at=?,completed_at=? WHERE id=?").run(sanitizeLog(error), sanitizeLog(logText), timestamp, timestamp, id);
}

function resolveStorageRoot(storageRoot?: string): string {
  return path.resolve(storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
}

function assertInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new MediaStudioError("Media processing path escapes storage root", 400);
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function sanitizeLog(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, "api_key=[redacted]")
    .slice(0, 20_000);
}
