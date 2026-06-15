import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { MediaStudioError } from "./media-studio.js";

export type GenerationStatusHistoryEntry = {
  id: string;
  generationJobId: string;
  status: string;
  progressPercent: number | null;
  message: string | null;
  providerStatus: string | null;
  createdAt: string;
};

export function recordGenerationStatusHistory(db: Database.Database, input: {
  generationJobId: string;
  status: string;
  createdAt: string;
  progressPercent?: number | null;
  message?: string | null;
  providerStatus?: string | null;
}) {
  if (!hasHistoryTable(db)) return;
  const message = input.message ? sanitizeHistoryMessage(input.message) : null;
  const providerStatus = input.providerStatus ? sanitizeHistoryMessage(input.providerStatus) : null;
  const progressPercent = normalizeProgress(input.progressPercent);
  const previous = db.prepare(`SELECT status,progress_percent AS progressPercent,message
    FROM media_generation_status_history WHERE generation_job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(input.generationJobId) as { status: string; progressPercent: number | null; message: string | null } | undefined;
  if (previous && previous.status === input.status && previous.progressPercent === progressPercent && previous.message === message) return;
  db.prepare(`INSERT INTO media_generation_status_history (id,generation_job_id,status,progress_percent,message,provider_status,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), input.generationJobId, input.status, progressPercent, message, providerStatus, input.createdAt);
}

export function listGenerationStatusHistory(db: Database.Database, projectId: string, jobId: string): GenerationStatusHistoryEntry[] {
  const job = db.prepare("SELECT id FROM media_generation_jobs WHERE id=? AND media_project_id=?").get(jobId, projectId);
  if (!job) throw new MediaStudioError("Generation job not found", 404);
  if (!hasHistoryTable(db)) return [];
  return db.prepare(`SELECT id,generation_job_id AS generationJobId,status,progress_percent AS progressPercent,message,provider_status AS providerStatus,created_at AS createdAt
    FROM media_generation_status_history WHERE generation_job_id=? ORDER BY created_at,rowid`).all(jobId) as GenerationStatusHistoryEntry[];
}

export function sanitizeHistoryMessage(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]+/gi, "api_key=[redacted]")
    .slice(0, 500);
}

function normalizeProgress(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasHistoryTable(db: Database.Database) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_generation_status_history'").get();
  return Boolean(row);
}
