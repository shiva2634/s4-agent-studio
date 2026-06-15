import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { detectFfmpeg, type ProcessRunner } from "./media-processing.js";
import { MediaStudioError, type MediaAuditWriter } from "./media-studio.js";

const execFileAsync = promisify(execFile);

export type RenderJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type RenderDraftOptions = {
  jobId: string;
  outputAssetId: string;
  now: string;
  fps?: number;
  width?: number;
  height?: number;
  includeLogo?: boolean;
  storageRoot?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  runner?: ProcessRunner;
};

export async function renderDraftVideo(db: Database.Database, projectId: string, options: RenderDraftOptions, audit: MediaAuditWriter) {
  const project = getProject(db, projectId);
  const renderSettings = resolveRenderSettings(project.aspectRatio, options);
  const plan = buildRenderPlan(db, projectId, options.includeLogo ?? true);
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const renderDir = path.resolve(storageRoot, "renders", sanitizeSegment(projectId), sanitizeSegment(options.jobId));
  assertInsideRoot(renderDir, storageRoot);
  await fs.mkdir(renderDir, { recursive: true });
  const outputPath = path.join(renderDir, "draft.mp4");
  const concatPath = path.join(renderDir, "concat.txt");

  insertRenderJob(db, options.jobId, projectId, options.now, { renderSettings, sceneCount: plan.scenes.length, includeLogo: Boolean(plan.logo) });
  setRenderStatus(db, options.jobId, "RUNNING", 1, options.now);
  audit("MEDIA_RENDER_STARTED", `Draft render started for ${project.name}`, { projectId, payload: { jobId: options.jobId, sceneCount: plan.scenes.length } });

  const logs: string[] = [];
  try {
    const detection = await detectFfmpeg(options);
    logs.push(`ffmpeg: ${detection.ffmpeg.available ? "available" : "unavailable"}`);
    if (!detection.ffmpeg.available) throw new MediaStudioError("FFmpeg is unavailable", 409);

    const segments: string[] = [];
    for (const [index, scene] of plan.scenes.entries()) {
      assertNotCancelled(db, options.jobId);
      const segmentPath = path.join(renderDir, `scene-${String(index + 1).padStart(3, "0")}.mp4`);
      const args = buildSceneRenderArgs(scene, segmentPath, renderSettings, plan.logo?.localPath ?? null);
      const result = await (options.runner ?? runProcess)(detection.ffmpegPath, args, { timeoutMs: options.timeoutMs ?? 120_000 });
      logs.push(`scene ${index + 1}: ${result.exitCode}\n${result.stderr}`);
      if (result.exitCode !== 0) throw new Error(`FFmpeg scene render failed for ${scene.title}: ${result.stderr}`);
      segments.push(segmentPath);
      setRenderStatus(db, options.jobId, "RUNNING", Math.round(((index + 1) / (plan.scenes.length + 1)) * 90), options.now, logs.join("\n"));
    }

    assertNotCancelled(db, options.jobId);
    await fs.writeFile(concatPath, segments.map((segment) => `file '${segment.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
    const concatResult = await (options.runner ?? runProcess)(detection.ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", outputPath], { timeoutMs: options.timeoutMs ?? 120_000 });
    logs.push(`concat: ${concatResult.exitCode}\n${concatResult.stderr}`);
    if (concatResult.exitCode !== 0) throw new Error(`FFmpeg concat failed: ${concatResult.stderr}`);

    const fileBuffer = await fs.readFile(outputPath).catch(() => Buffer.alloc(0));
    const checksum = createHash("sha256").update(fileBuffer).digest("hex");
    const sizeBytes = fileBuffer.length;
    db.prepare(`INSERT INTO media_assets (id,media_project_id,scene_id,kind,label,source,status,file_name,original_name,mime_type,size_bytes,checksum_sha256,local_path,preview_path,qc_status,qc_issues_json,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(options.outputAssetId, projectId, null, "video", `Draft render ${options.jobId}`, "local-render", "RENDERED", "draft.mp4", "draft.mp4", "video/mp4", sizeBytes, checksum, outputPath, outputPath, "PENDING", "[]", JSON.stringify({ renderJobId: options.jobId, sceneIds: plan.scenes.map((scene) => scene.id), renderSettings }), options.now, options.now);
    db.prepare("UPDATE media_render_jobs SET output_asset_id=? WHERE id=?").run(options.outputAssetId, options.jobId);
    setRenderStatus(db, options.jobId, "COMPLETED", 100, options.now, logs.join("\n"), null, options.now);
    audit("MEDIA_RENDER_COMPLETED", `Draft render completed for ${project.name}`, { projectId, payload: { jobId: options.jobId, outputAssetId: options.outputAssetId, outputPath } });
    return getRenderJob(db, projectId, options.jobId);
  } catch (error) {
    if (error instanceof RenderCancelledError) {
      setRenderStatus(db, options.jobId, "CANCELLED", getRenderProgress(db, options.jobId), options.now, logs.join("\n"), "Render cancelled", options.now);
      audit("MEDIA_RENDER_CANCELLED", `Draft render cancelled for ${project.name}`, { projectId, payload: { jobId: options.jobId } });
      return getRenderJob(db, projectId, options.jobId);
    }
    const message = error instanceof Error ? error.message : "Draft render failed";
    setRenderStatus(db, options.jobId, "FAILED", getRenderProgress(db, options.jobId), options.now, logs.join("\n"), message, options.now);
    audit("MEDIA_RENDER_FAILED", message, { projectId, payload: { jobId: options.jobId } });
    if (error instanceof MediaStudioError) throw error;
    throw new MediaStudioError(message, 500);
  }
}

export function listRenderJobs(db: Database.Database, projectId: string) {
  return db.prepare(`SELECT id,media_project_id AS mediaProjectId,status,progress,output_asset_id AS outputAssetId,request_json AS requestJson,log_text AS logText,error,cancel_requested AS cancelRequested,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM media_render_jobs WHERE media_project_id=? ORDER BY created_at DESC`).all(projectId);
}

export function cancelRenderJob(db: Database.Database, projectId: string, jobId: string, timestamp: string, audit: MediaAuditWriter) {
  const job = getRenderJob(db, projectId, jobId);
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
  db.prepare("UPDATE media_render_jobs SET cancel_requested=1,status='CANCELLED',error='Render cancelled',updated_at=?,completed_at=? WHERE id=? AND media_project_id=?")
    .run(timestamp, timestamp, jobId, projectId);
  audit("MEDIA_RENDER_CANCELLED", "Draft render cancellation requested", { projectId, payload: { jobId } });
  return getRenderJob(db, projectId, jobId);
}

export function validateRenderReadiness(db: Database.Database, projectId: string) {
  buildRenderPlan(db, projectId, true);
  return { ready: true };
}

function buildRenderPlan(db: Database.Database, projectId: string, includeLogo: boolean) {
  const scenes = db.prepare(`SELECT id,position,title,duration_seconds AS durationSeconds,dialogue,aspect_ratio AS aspectRatio,approved_at AS approvedAt
    FROM media_scenes WHERE media_project_id=? ORDER BY position`).all(projectId) as SceneRow[];
  if (!scenes.length) throw new MediaStudioError("Cannot render without scenes", 409);
  const assets = db.prepare(`SELECT id,scene_id AS sceneId,kind,label,local_path AS localPath,qc_status AS qcStatus,metadata_json AS metadataJson
    FROM media_assets WHERE media_project_id=? ORDER BY created_at DESC`).all(projectId) as AssetRow[];
  const backgroundMusic = assets.find((asset) => asset.kind === "audio" && asset.localPath && parseAudioMetadata(asset).backgroundMusic) ?? null;
  const scenePlans = scenes.map((scene) => {
    if (!scene.approvedAt) throw new MediaStudioError(`Scene "${scene.title}" must be approved before rendering`, 409);
    const asset = assets.find((candidate) => candidate.sceneId === scene.id && ["image", "video"].includes(candidate.kind) && candidate.localPath);
    if (!asset) throw new MediaStudioError(`Scene "${scene.title}" is missing an image or video asset`, 409);
    if (asset.qcStatus === "FAILED") throw new MediaStudioError(`Scene "${scene.title}" has failed QC`, 409);
    const sceneAudio = assets
      .filter((candidate) => candidate.sceneId === scene.id && candidate.kind === "audio" && candidate.localPath && candidate.qcStatus !== "FAILED")
      .map((audio) => ({ asset: audio, settings: parseAudioMetadata(audio) }))
      .filter((audio) => !audio.settings.muted);
    return { ...scene, asset, audio: sceneAudio, backgroundMusic: backgroundMusic ? { asset: backgroundMusic, settings: parseAudioMetadata(backgroundMusic) } : null };
  });
  const logo = includeLogo ? assets.find((asset) => asset.sceneId === null && asset.kind === "image" && asset.localPath && /logo/i.test(asset.label)) ?? null : null;
  return { scenes: scenePlans, logo };
}

function buildSceneRenderArgs(scene: ScenePlan, outputPath: string, settings: RenderSettings, logoPath: string | null) {
  const args = ["-y"];
  if (scene.asset.kind === "image") args.push("-loop", "1", "-t", String(scene.durationSeconds));
  args.push("-i", scene.asset.localPath);
  if (logoPath) args.push("-i", logoPath);
  const audioInputs: Array<{ inputIndex: number; settings: AudioSettings; label: string }> = [];
  let nextInputIndex = logoPath ? 2 : 1;
  for (const audio of scene.audio) {
    args.push(...audioInputArgs(audio.asset.localPath, audio.settings));
    audioInputs.push({ inputIndex: nextInputIndex, settings: audio.settings, label: `a${audioInputs.length}` });
    nextInputIndex += 1;
  }
  if (scene.backgroundMusic && !scene.backgroundMusic.settings.muted) {
    args.push(...audioInputArgs(scene.backgroundMusic.asset.localPath, scene.backgroundMusic.settings));
    audioInputs.push({ inputIndex: nextInputIndex, settings: { ...scene.backgroundMusic.settings, volume: Math.min(scene.backgroundMusic.settings.volume, scene.audio.length ? 0.25 : 0.35) }, label: `a${audioInputs.length}` });
    nextInputIndex += 1;
  }
  args.push("-f", "lavfi", "-t", String(scene.durationSeconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  const silentInputIndex = nextInputIndex;
  const filters = [
    `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease`,
    `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${settings.fps}`,
    `drawtext=text='${escapeDrawText(scene.dialogue || "")}':x=(w-text_w)/2:y=h-(text_h*2):fontcolor=white:fontsize=36:box=1:boxcolor=black@0.55:boxborderw=12`
  ];
  const audioFilter = buildAudioFilter(audioInputs, silentInputIndex, scene.durationSeconds);
  if (logoPath || audioFilter) {
    const videoFilter = logoPath ? `[0:v]${filters.join(",")}[base];[base][1:v]overlay=W-w-32:32[v]` : `[0:v]${filters.join(",")}[v]`;
    args.push("-filter_complex", [videoFilter, audioFilter].filter(Boolean).join(";"), "-map", "[v]", "-map", audioFilter ? "[aout]" : `${silentInputIndex}:a`);
  } else {
    args.push("-vf", filters.join(","), "-map", "0:v", "-map", `${silentInputIndex}:a`);
  }
  args.push("-t", String(scene.durationSeconds), "-r", String(settings.fps), "-s", `${settings.width}x${settings.height}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-shortest", "-c:a", "aac", "-ar", "48000", "-ac", "2", outputPath);
  return args;
}

function audioInputArgs(localPath: string, settings: AudioSettings): string[] {
  const args: string[] = [];
  if (settings.trimStartSeconds > 0) args.push("-ss", String(settings.trimStartSeconds));
  if (settings.trimEndSeconds !== null && settings.trimEndSeconds > settings.trimStartSeconds) args.push("-t", String(settings.trimEndSeconds - settings.trimStartSeconds));
  args.push("-i", localPath);
  return args;
}

function buildAudioFilter(inputs: Array<{ inputIndex: number; settings: AudioSettings; label: string }>, silentInputIndex: number, sceneDurationSeconds: number): string {
  if (!inputs.length) return "";
  const chains = inputs.map((input) => {
    const filters = [`volume=${input.settings.volume.toFixed(3)}`];
    if (input.settings.fadeInSeconds > 0) filters.push(`afade=t=in:st=0:d=${input.settings.fadeInSeconds}`);
    if (input.settings.fadeOutSeconds > 0) filters.push(`afade=t=out:st=${Math.max(0, sceneDurationSeconds - input.settings.fadeOutSeconds)}:d=${input.settings.fadeOutSeconds}`);
    filters.push("aresample=48000", "aformat=channel_layouts=stereo");
    return `[${input.inputIndex}:a]${filters.join(",")}[${input.label}]`;
  });
  const labels = inputs.map((input) => `[${input.label}]`).join("");
  return `${chains.join(";")};${labels}[${silentInputIndex}:a]amix=inputs=${inputs.length + 1}:duration=first:dropout_transition=0,volume=1.0[aout]`;
}

function parseAudioMetadata(asset: AssetRow): AudioSettings {
  let parsed: Record<string, unknown> = {};
  if (asset.metadataJson) {
    try {
      const value = JSON.parse(asset.metadataJson) as unknown;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const role = typeof parsed.audioRole === "string" ? parsed.audioRole : "NARRATION";
  return {
    role,
    volume: numberSetting(parsed.volume, role === "MUSIC" ? 0.25 : 1),
    trimStartSeconds: numberSetting(parsed.trimStartSeconds, 0),
    trimEndSeconds: typeof parsed.trimEndSeconds === "number" && Number.isFinite(parsed.trimEndSeconds) ? parsed.trimEndSeconds : null,
    fadeInSeconds: numberSetting(parsed.fadeInSeconds, 0),
    fadeOutSeconds: numberSetting(parsed.fadeOutSeconds, 0),
    muted: Boolean(parsed.muted),
    backgroundMusic: Boolean(parsed.backgroundMusic)
  };
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function resolveRenderSettings(aspectRatio: string, options: RenderDraftOptions): RenderSettings {
  const fps = options.fps ?? 30;
  if (options.width && options.height) return { width: options.width, height: options.height, fps };
  if (aspectRatio === "9:16") return { width: 1080, height: 1920, fps };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080, fps };
  return { width: 1920, height: 1080, fps };
}

function insertRenderJob(db: Database.Database, id: string, projectId: string, timestamp: string, request: unknown) {
  db.prepare(`INSERT INTO media_render_jobs (id,media_project_id,status,progress,request_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, projectId, "QUEUED", 0, JSON.stringify(request), timestamp, timestamp);
}

function setRenderStatus(db: Database.Database, id: string, status: RenderJobStatus, progress: number, timestamp: string, logText = "", error: string | null = null, completedAt: string | null = null) {
  db.prepare("UPDATE media_render_jobs SET status=?,progress=?,log_text=?,error=?,updated_at=?,completed_at=COALESCE(?,completed_at) WHERE id=?")
    .run(status, progress, sanitizeLog(logText), error, timestamp, completedAt, id);
}

function getRenderJob(db: Database.Database, projectId: string, jobId: string) {
  const job = db.prepare(`SELECT id,media_project_id AS mediaProjectId,status,progress,output_asset_id AS outputAssetId,request_json AS requestJson,log_text AS logText,error,cancel_requested AS cancelRequested,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM media_render_jobs WHERE id=? AND media_project_id=?`).get(jobId, projectId) as any;
  if (!job) throw new MediaStudioError("Render job not found", 404);
  return job;
}

function getRenderProgress(db: Database.Database, jobId: string) {
  return (db.prepare("SELECT progress FROM media_render_jobs WHERE id=?").get(jobId) as { progress: number } | undefined)?.progress ?? 0;
}

function assertNotCancelled(db: Database.Database, jobId: string) {
  const row = db.prepare("SELECT cancel_requested AS cancelRequested,status FROM media_render_jobs WHERE id=?").get(jobId) as { cancelRequested: number; status: string } | undefined;
  if (row?.cancelRequested || row?.status === "CANCELLED") throw new RenderCancelledError();
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

type RenderSettings = { width: number; height: number; fps: number };
type SceneRow = { id: string; position: number; title: string; durationSeconds: number; dialogue: string; aspectRatio: string; approvedAt: string | null };
type AssetRow = { id: string; sceneId: string | null; kind: string; label: string; localPath: string; qcStatus: string; metadataJson?: string | null };
type AudioSettings = { role: string; volume: number; trimStartSeconds: number; trimEndSeconds: number | null; fadeInSeconds: number; fadeOutSeconds: number; muted: boolean; backgroundMusic: boolean };
type ScenePlan = SceneRow & { asset: AssetRow; audio: Array<{ asset: AssetRow; settings: AudioSettings }>; backgroundMusic: { asset: AssetRow; settings: AudioSettings } | null };

class RenderCancelledError extends Error {}

function getProject(db: Database.Database, projectId: string) {
  const project = db.prepare("SELECT id,name,aspect_ratio AS aspectRatio FROM media_projects WHERE id=? AND status='ACTIVE'").get(projectId) as { id: string; name: string; aspectRatio: string } | undefined;
  if (!project) throw new MediaStudioError("Media project not found", 404);
  return project;
}

function resolveStorageRoot(storageRoot?: string): string {
  return path.resolve(storageRoot ?? process.env.S4_MEDIA_STORAGE_PATH ?? "./data/media-assets");
}

function assertInsideRoot(candidatePath: string, storageRoot: string): void {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new MediaStudioError("Media render path escapes storage root", 400);
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "item";
}

function escapeDrawText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\n/g, " ");
}

function sanitizeLog(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, "api_key=[redacted]")
    .slice(0, 40_000);
}
