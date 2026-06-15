import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type ProjectStatus = "ACTIVE" | "DEREGISTERED";

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

export function listActiveProjects(db: Database.Database): ProjectRow[] {
  return db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE status='ACTIVE' ORDER BY created_at DESC").all() as ProjectRow[];
}

export function registerOrReactivateProject(db: Database.Database, input: { id: string; name: string; rootPath: string; now: string }, audit: ProjectAuditWriter) {
  const rootPath = normalizeProjectRoot(input.rootPath);
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new ProjectRegistrationError("Project directory does not exist", 400);
  }

  const existing = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE root_path=?").get(rootPath) as ProjectRow | undefined;
  if (existing?.status === "ACTIVE") {
    throw new ProjectRegistrationError("This project directory is already registered", 409);
  }
  if (existing?.status === "DEREGISTERED") {
    db.prepare("UPDATE projects SET name=?,status='ACTIVE',deregistered_at=NULL,deregistered_by=NULL,updated_at=? WHERE id=?")
      .run(input.name, input.now, existing.id);
    audit("PROJECT_REREGISTERED", `Project ${input.name} re-registered`, {
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
