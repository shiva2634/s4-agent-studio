import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProposalOperation } from "@s4/shared";
import { resolveRealPathInsideProject } from "./project-files.js";

const execFileAsync = promisify(execFile);

export type ChangeProposalInput = {
  id: string;
  taskId: string;
  taskRoundId?: string | null;
  agentId?: string | null;
  taskAssignmentId?: string | null;
  projectId: string;
  rootPath: string;
  filePath: string;
  operation: ProposalOperation;
  proposedContent?: string;
  reason: string;
  now: string;
};

export type AuditWriter = (eventType: string, summary: string, values?: { projectId?: string; taskId?: string; payload?: unknown }) => void;

const blockedSegments = new Set([".git", "node_modules"]);
const blockedBasenames = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^id_rsa$/i,
  /^id_dsa$/i,
  /^id_ed25519$/i,
  /secret/i,
  /credential/i,
  /token/i,
  /password/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i
];

export function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function isSecretPath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.split("/").some((segment) => blockedBasenames.some((pattern) => pattern.test(segment)));
}

export function validateProposalPath(rootPath: string, requestedPath: string) {
  const normalized = requestedPath.replaceAll("\\", "/");
  if (path.isAbsolute(requestedPath) || /^[a-zA-Z]:\//.test(normalized)) throw new Error("Proposed file path must be relative to the selected project");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) throw new Error("Proposed file path is required");
  if (parts.includes("..")) throw new Error("Directory traversal is not allowed in proposed file paths");
  if (parts.some((part) => blockedSegments.has(part))) throw new Error("Proposed file path targets a blocked project directory");
  if (isSecretPath(normalized)) throw new Error("Secret files cannot be proposed or read");
  const root = path.resolve(rootPath);
  const absolutePath = path.resolve(root, ...parts);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) throw new Error("Proposed file path is outside the selected project");
  return { absolutePath, relativePath: parts.join("/") };
}

export function assertReadableProjectFilePath(rootPath: string, requestedPath: string) {
  return validateProposalPath(rootPath, requestedPath);
}

async function readExistingContent(rootPath: string, relativePath: string) {
  try {
    const target = await resolveRealPathInsideProject(rootPath, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("Path is not a file");
    if (stat.size > 500_000) throw new Error("File exceeds the 500 KB proposal limit");
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (error instanceof Error && /outside|not a file|exceeds/.test(error.message)) throw error;
    return null;
  }
}

function createUnifiedDiff(filePath: string, originalContent: string | null, proposedContent: string | null, operation: ProposalOperation) {
  const before = originalContent?.split(/\r?\n/) ?? [];
  const after = proposedContent?.split(/\r?\n/) ?? [];
  const header = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${before.length} +1,${after.length} @@`];
  if (operation === "DELETE") return [...header, ...before.map((line) => `-${line}`)].join("\n");
  if (operation === "CREATE") return [...header, ...after.map((line) => `+${line}`)].join("\n");
  return [...header, ...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`)].join("\n");
}

function hasColumn(db: Database.Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function isTestPath(filePath: string) {
  const normalized = filePath.toLowerCase();
  return normalized.includes("__tests__") || normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes(".test.") || normalized.includes(".spec.") || normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts") || normalized.endsWith(".test.tsx") || normalized.endsWith(".spec.tsx");
}

function weakensTests(input: ChangeProposalInput) {
  if (!isTestPath(input.filePath)) return false;
  if (input.operation === "DELETE") return true;
  const proposed = input.proposedContent ?? "";
  return /\b(?:describe|it|test)\.skip\b/.test(proposed) || /\b(?:xit|xtest)\s*\(/.test(proposed) || /\.only\s*\(/.test(proposed) || /skip(?:ped)?\s+test/i.test(proposed) || /disable(?:d)?\s+test/i.test(proposed);
}

function assertProposalAuthorAllowed(db: Database.Database, input: ChangeProposalInput) {
  if (hasTable(db, "projects")) {
    const projectHasStatus = hasColumn(db, "projects", "status");
    const project = projectHasStatus
      ? db.prepare("SELECT id,status FROM projects WHERE id=?").get(input.projectId) as { id: string; status: string } | undefined
      : db.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId) as { id: string } | undefined;
    if (projectHasStatus && project && "status" in project && project.status !== "ACTIVE") throw new Error("Specialists may inspect and propose only for active registered projects");
  }
  if (input.agentId && hasTable(db, "agents")) {
    const agent = db.prepare("SELECT id,role,project_id AS projectId,status FROM agents WHERE id=?").get(input.agentId) as { id: string; role: string; projectId: string | null; status: string } | undefined;
    if (!agent || agent.status !== "ACTIVE") throw new Error("Specialist agent is not active");
    if (agent.projectId && agent.projectId !== input.projectId) throw new Error("Specialist agent is not assigned to this project");
    if (agent.role === "SECURITY_REVIEW" || agent.role === "FINAL_REVIEW") throw new Error("Read-only specialist agents cannot generate mutation proposals");
  }
  if (weakensTests(input) && hasTable(db, "tasks") && hasColumn(db, "tasks", "risk_level")) {
    const task = db.prepare("SELECT risk_level AS riskLevel FROM tasks WHERE id=?").get(input.taskId) as { riskLevel: string } | undefined;
    if (task && task.riskLevel !== "high" && task.riskLevel !== "critical") {
      throw new Error("Weakening, deleting, skipping, or disabling tests requires explicit high-risk approval");
    }
  }
}

export async function buildProposal(input: ChangeProposalInput) {
  const { absolutePath, relativePath } = validateProposalPath(input.rootPath, input.filePath);
  const originalContent = await readExistingContent(input.rootPath, relativePath);
  if (input.operation === "CREATE" && originalContent !== null) throw new Error("CREATE proposal target already exists");
  if ((input.operation === "UPDATE" || input.operation === "DELETE") && originalContent === null) throw new Error(`${input.operation} proposal target does not exist`);
  if (input.operation !== "DELETE" && input.proposedContent === undefined) throw new Error("Proposed content is required for CREATE and UPDATE proposals");
  const proposedContent = input.operation === "DELETE" ? null : input.proposedContent ?? "";
  return {
    id: input.id,
    taskId: input.taskId,
    projectId: input.projectId,
    filePath: relativePath,
    operation: input.operation,
    originalContentHash: originalContent === null ? null : hashContent(originalContent),
    originalContent,
    proposedContent,
    unifiedDiff: createUnifiedDiff(relativePath, originalContent, proposedContent, input.operation),
    reason: input.reason,
    absolutePath,
    now: input.now
  };
}

export async function insertProposal(db: Database.Database, input: ChangeProposalInput) {
  assertProposalAuthorAllowed(db, input);
  const proposal = await buildProposal(input);
  const hasTaskRoundColumn = hasColumn(db, "change_proposals", "task_round_id");
  const hasAgentColumn = hasColumn(db, "change_proposals", "agent_id");
  const duplicate = hasTaskRoundColumn
    ? db.prepare(`SELECT id,task_id AS taskId,task_round_id AS taskRoundId,agent_id AS agentId,file_path AS filePath,operation,original_content_hash AS originalContentHash,proposed_content AS proposedContent,reason,status,created_at AS createdAt,updated_at AS updatedAt
      FROM change_proposals WHERE task_id=? AND COALESCE(task_round_id,'')=COALESCE(?, '') AND file_path=? AND operation=? AND COALESCE(original_content_hash,'')=COALESCE(?, '') AND COALESCE(proposed_content,'')=COALESCE(?, '')
      ORDER BY created_at DESC LIMIT 1`).get(proposal.taskId, input.taskRoundId ?? null, proposal.filePath, proposal.operation, proposal.originalContentHash, proposal.proposedContent) as { id: string } | undefined
    : db.prepare(`SELECT id,task_id AS taskId,file_path AS filePath,operation,original_content_hash AS originalContentHash,proposed_content AS proposedContent,reason,status,created_at AS createdAt,updated_at AS updatedAt
      FROM change_proposals WHERE task_id=? AND file_path=? AND operation=? AND COALESCE(original_content_hash,'')=COALESCE(?, '') AND COALESCE(proposed_content,'')=COALESCE(?, '')
      ORDER BY created_at DESC LIMIT 1`).get(proposal.taskId, proposal.filePath, proposal.operation, proposal.originalContentHash, proposal.proposedContent) as { id: string } | undefined;
  if (duplicate) return { ...proposal, id: duplicate.id };
  if (hasTaskRoundColumn) {
    if (hasAgentColumn && hasColumn(db, "change_proposals", "task_assignment_id")) {
      db.prepare(`INSERT INTO change_proposals
        (id,task_id,task_round_id,agent_id,task_assignment_id,project_id,file_path,operation,original_content,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(proposal.id, proposal.taskId, input.taskRoundId ?? null, input.agentId ?? null, input.taskAssignmentId ?? null, proposal.projectId, proposal.filePath, proposal.operation, proposal.originalContent, proposal.originalContentHash, proposal.proposedContent, proposal.unifiedDiff, proposal.reason, "PENDING", proposal.now, proposal.now);
    } else {
      db.prepare(`INSERT INTO change_proposals
        (id,task_id,task_round_id,project_id,file_path,operation,original_content,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(proposal.id, proposal.taskId, input.taskRoundId ?? null, proposal.projectId, proposal.filePath, proposal.operation, proposal.originalContent, proposal.originalContentHash, proposal.proposedContent, proposal.unifiedDiff, proposal.reason, "PENDING", proposal.now, proposal.now);
    }
  } else {
    db.prepare(`INSERT INTO change_proposals
      (id,task_id,project_id,file_path,operation,original_content,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(proposal.id, proposal.taskId, proposal.projectId, proposal.filePath, proposal.operation, proposal.originalContent, proposal.originalContentHash, proposal.proposedContent, proposal.unifiedDiff, proposal.reason, "PENDING", proposal.now, proposal.now);
  }
  return proposal;
}

async function createGitCheckpoint(rootPath: string, taskId: string) {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: rootPath, windowsHide: true });
    await execFileAsync("git", ["add", "-A"], { cwd: rootPath, windowsHide: true });
    await execFileAsync("git", ["commit", "--allow-empty", "-m", `S4 checkpoint before applying ${taskId}`], { cwd: rootPath, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function applyApprovedProposals(db: Database.Database, rootPath: string, taskId: string, now: string, audit: AuditWriter) {
  const task = db.prepare("SELECT id,project_id AS projectId,status FROM tasks WHERE id=?").get(taskId) as { id: string; projectId: string; status: string } | undefined;
  if (!task) throw new Error("Task not found");
  const taskApprovals = db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE task_id=? AND status='APPROVED'").get(taskId) as { count: number };
  if (taskApprovals.count === 0) throw new Error("An approved task approval is required before applying proposals");
  const pending = db.prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE task_id=? AND status='PENDING'").get(taskId) as { count: number };
  if (pending.count > 0) throw new Error("All proposals must be approved or rejected before applying");
  const proposals = db.prepare("SELECT id,file_path AS filePath,operation,original_content_hash AS originalContentHash,proposed_content AS proposedContent,status FROM change_proposals WHERE task_id=? AND status='APPROVED' ORDER BY created_at")
    .all(taskId) as Array<{ id: string; filePath: string; operation: ProposalOperation; originalContentHash: string | null; proposedContent: string | null; status: string }>;
  if (!proposals.length) throw new Error("No approved proposals to apply");

  for (const proposal of proposals) {
    validateProposalPath(rootPath, proposal.filePath);
    const currentContent = await readExistingContent(rootPath, proposal.filePath);
    const currentHash = currentContent === null ? null : hashContent(currentContent);
    if (currentHash !== proposal.originalContentHash) throw new Error(`File changed after proposal creation: ${proposal.filePath}`);
  }

  const checkpointCreated = await createGitCheckpoint(rootPath, taskId);
  for (const proposal of proposals) {
    const { absolutePath } = validateProposalPath(rootPath, proposal.filePath);
    if (proposal.operation === "DELETE") {
      await fs.rm(absolutePath);
    } else {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, proposal.proposedContent ?? "", "utf8");
    }
    db.prepare("UPDATE change_proposals SET status='APPLIED',updated_at=? WHERE id=?").run(now, proposal.id);
    audit("CHANGE_PROPOSAL_APPLIED", `${proposal.operation} applied to ${proposal.filePath}`, { projectId: task.projectId, taskId, payload: { proposalId: proposal.id, checkpointCreated } });
  }
  db.prepare("UPDATE tasks SET status='COMPLETED',updated_at=? WHERE id=?").run(now, taskId);
  return { applied: proposals.length, checkpointCreated };
}
