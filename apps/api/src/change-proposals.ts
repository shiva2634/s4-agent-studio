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
  const proposal = await buildProposal(input);
  db.prepare(`INSERT INTO change_proposals
    (id,task_id,project_id,file_path,operation,original_content,original_content_hash,proposed_content,unified_diff,reason,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(proposal.id, proposal.taskId, proposal.projectId, proposal.filePath, proposal.operation, proposal.originalContent, proposal.originalContentHash, proposal.proposedContent, proposal.unifiedDiff, proposal.reason, "PENDING", proposal.now, proposal.now);
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
