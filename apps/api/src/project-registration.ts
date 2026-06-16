import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type ProjectStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DEREGISTERED";

export type ProjectAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; payload?: unknown }) => void;

export class ProjectRegistrationError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export type ProjectRow = {
  id: string;
  name: string;
  rootPath: string;
  status: ProjectStatus;
};

export function normalizeProjectRoot(rootPath: string) {
  return path.resolve(rootPath);
}

function projectPathKey(rootPath: string) {
  const normalized = normalizeProjectRoot(rootPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function listActiveProjects(db: Database.Database): ProjectRow[] {
  return db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE status='ACTIVE' ORDER BY created_at DESC").all() as ProjectRow[];
}

export function listManageableProjects(db: Database.Database): ProjectRow[] {
  return db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE status IN ('ACTIVE','PAUSED','ARCHIVED') ORDER BY created_at DESC").all() as ProjectRow[];
}

export function registerOrReactivateProject(db: Database.Database, input: { id: string; name: string; rootPath: string; now: string }, audit: ProjectAuditWriter) {
  const rootPath = normalizeProjectRoot(input.rootPath);
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new ProjectRegistrationError("Project directory does not exist", 400);
  }

  const incomingPathKey = projectPathKey(rootPath);
  const existingProjects = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects").all() as ProjectRow[];
  const existing = existingProjects.find((project) => projectPathKey(project.rootPath) === incomingPathKey);
  if (existing?.status && existing.status !== "DEREGISTERED") {
    throw new ProjectRegistrationError("This project directory is already registered", 409);
  }
  if (existing?.status === "DEREGISTERED") {
    db.prepare("UPDATE projects SET name=?,root_path=?,status='ACTIVE',deregistered_at=NULL,deregistered_by=NULL,updated_at=? WHERE id=?")
      .run(input.name, rootPath, input.now, existing.id);
    audit("PROJECT_REACTIVATED", `Project ${input.name} reactivated`, {
      projectId: existing.id,
      payload: { projectId: existing.id, projectName: input.name, normalizedRootPath: rootPath, previousStatus: existing.status, newStatus: "ACTIVE", timestamp: input.now }
    });
    return { id: existing.id, name: input.name, rootPath, status: "ACTIVE" as const, reactivated: true };
  }

  db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(input.id, input.name, rootPath, "ACTIVE", input.now, input.now);
  audit("PROJECT_CREATED", `Project ${input.name} registered`, { projectId: input.id, payload: { rootPath } });
  return { id: input.id, name: input.name, rootPath, status: "ACTIVE" as const, reactivated: false };
}

export function deregisterProject(db: Database.Database, projectId: string, timestamp: string, audit: ProjectAuditWriter) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as ProjectRow | undefined;
  if (!project) throw new ProjectRegistrationError("Project not found", 404);
  if (project.status === "DEREGISTERED") {
    return { id: project.id, name: project.name, rootPath: project.rootPath, status: "DEREGISTERED" as const, alreadyDeregistered: true };
  }

  db.prepare("UPDATE projects SET status='DEREGISTERED',deregistered_at=?,deregistered_by=?,updated_at=? WHERE id=?")
    .run(timestamp, "local-user", timestamp, project.id);
  audit("PROJECT_DEREGISTERED", `Project ${project.name} de-registered`, {
    projectId: project.id,
    payload: {
      projectId: project.id,
      projectName: project.name,
      normalizedRootPath: project.rootPath,
      previousStatus: project.status,
      newStatus: "DEREGISTERED",
      timestamp,
      action: "PROJECT_DEREGISTERED"
    }
  });
  return { id: project.id, name: project.name, rootPath: project.rootPath, status: "DEREGISTERED" as const, alreadyDeregistered: false };
}

export function pauseProject(db: Database.Database, projectId: string, timestamp: string, audit: ProjectAuditWriter) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as ProjectRow | undefined;
  if (!project) throw new ProjectRegistrationError("Project not found", 404);
  if (project.status === "PAUSED") {
    return { id: project.id, name: project.name, rootPath: project.rootPath, status: "PAUSED" as const, alreadyPaused: true };
  }
  if (project.status !== "ACTIVE") {
    throw new ProjectRegistrationError("Project cannot be paused", 409);
  }

  db.prepare("UPDATE projects SET status='PAUSED',paused_at=?,updated_at=? WHERE id=?")
    .run(timestamp, timestamp, project.id);
  audit("PROJECT_PAUSED", `Project ${project.name} paused`, {
    projectId: project.id,
    payload: {
      projectId: project.id,
      projectName: project.name,
      normalizedRootPath: project.rootPath,
      previousStatus: project.status,
      newStatus: "PAUSED",
      timestamp,
      action: "PROJECT_PAUSED"
    }
  });
  return { id: project.id, name: project.name, rootPath: project.rootPath, status: "PAUSED" as const, alreadyPaused: false };
}

export function resumeProject(db: Database.Database, projectId: string, timestamp: string, audit: ProjectAuditWriter) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as ProjectRow | undefined;
  if (!project) throw new ProjectRegistrationError("Project not found", 404);
  if (project.status === "ACTIVE") {
    return { id: project.id, name: project.name, rootPath: project.rootPath, status: "ACTIVE" as const, alreadyActive: true };
  }
  if (project.status !== "PAUSED") {
    throw new ProjectRegistrationError("Project cannot be resumed", 409);
  }

  db.prepare("UPDATE projects SET status='ACTIVE',paused_at=NULL,updated_at=? WHERE id=?")
    .run(timestamp, project.id);
  audit("PROJECT_RESUMED", `Project ${project.name} resumed`, {
    projectId: project.id,
    payload: {
      projectId: project.id,
      projectName: project.name,
      normalizedRootPath: project.rootPath,
      previousStatus: project.status,
      newStatus: "ACTIVE",
      timestamp,
      action: "PROJECT_RESUMED"
    }
  });
  return { id: project.id, name: project.name, rootPath: project.rootPath, status: "ACTIVE" as const, alreadyActive: false };
}

export function archiveProject(db: Database.Database, projectId: string, timestamp: string, audit: ProjectAuditWriter) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=?").get(projectId) as ProjectRow | undefined;
  if (!project) throw new ProjectRegistrationError("Project not found", 404);
  if (project.status === "ARCHIVED") {
    return { id: project.id, name: project.name, rootPath: project.rootPath, status: "ARCHIVED" as const, alreadyArchived: true };
  }
  if (project.status !== "ACTIVE" && project.status !== "PAUSED") {
    throw new ProjectRegistrationError("Project cannot be archived", 409);
  }

  db.prepare("UPDATE projects SET status='ARCHIVED',paused_at=NULL,archived_at=?,updated_at=? WHERE id=?")
    .run(timestamp, timestamp, project.id);
  audit("PROJECT_ARCHIVED", `Project ${project.name} archived`, {
    projectId: project.id,
    payload: {
      projectId: project.id,
      projectName: project.name,
      normalizedRootPath: project.rootPath,
      previousStatus: project.status,
      newStatus: "ARCHIVED",
      timestamp,
      action: "PROJECT_ARCHIVED"
    }
  });
  return { id: project.id, name: project.name, rootPath: project.rootPath, status: "ARCHIVED" as const, alreadyArchived: false };
}
