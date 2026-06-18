import type Database from "better-sqlite3";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ScaffoldJobMode } from "@s4/shared";
import { hashContent, insertProposal, validateProposalPath } from "./change-proposals.js";
import { ensureDefaultProjectSecurityPolicy, normalizeProjectRoot } from "./project-registration.js";
import { assertFilePermission, assertWorkspaceTargetAllowed } from "./security-policy.js";
import { createTaskRound, updateTaskRound } from "./task-workflow.js";
import { attachSpecialistProposalOwnership, decomposeSpecialistAssignments } from "./specialist-orchestration.js";

export type ScaffoldAuditWriter = (eventType: string, summary: string, values?: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown }) => void;

export class ScaffoldError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

type ScaffoldTemplateRow = {
  id: string;
  name: string;
  description: string;
  projectType: string;
  defaultFoldersJson: string;
  packageScriptsJson: string;
  starterFilesJson: string;
  recommendedSpecialistAgentsJson: string;
  riskLevel: string;
  allowedOperationsJson: string;
  requiredApprovalsJson: string;
  metadataJson: string;
  isBuiltin: number;
  createdAt: string;
  updatedAt: string;
};

type ScaffoldFile = { path: string; content: string };
type ProjectRow = { id: string; name: string; rootPath: string; status: string };

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function normalizeTemplate(row: ScaffoldTemplateRow) {
  return {
    ...row,
    defaultFolders: safeJson<string[]>(row.defaultFoldersJson, []),
    packageScripts: safeJson<Record<string, string>>(row.packageScriptsJson, {}),
    starterFiles: safeJson<ScaffoldFile[]>(row.starterFilesJson, []),
    recommendedSpecialistAgents: safeJson<string[]>(row.recommendedSpecialistAgentsJson, []),
    allowedOperations: safeJson<string[]>(row.allowedOperationsJson, []),
    requiredApprovals: safeJson<string[]>(row.requiredApprovalsJson, []),
    metadata: safeJson<Record<string, unknown>>(row.metadataJson, {})
  };
}

function projectPathKey(rootPath: string) {
  const normalized = normalizeProjectRoot(rootPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "app-studio-project";
}

function assertRelativeName(value: string, label: string) {
  const normalized = value.replaceAll("\\", "/");
  if (path.isAbsolute(value) || /^[a-zA-Z]:\//.test(normalized)) throw new ScaffoldError(`${label} must be relative`);
  if (normalized.split("/").some((part) => part === "..")) throw new ScaffoldError(`${label} cannot contain traversal`);
  if (!/^[a-zA-Z0-9._/-]+$/.test(normalized)) throw new ScaffoldError(`${label} contains unsupported characters`);
  return normalized.split("/").filter(Boolean).join("/");
}

function assertInside(rootPath: string, targetPath: string) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new ScaffoldError("Generated paths must stay inside the configured workspace root");
}

function assertSafeScripts(scripts: Record<string, string>) {
  const unsafe = /\b(?:rm|del|erase|rmdir|curl|wget|scp|ssh|powershell|pwsh|bash|sh)\b|Remove-Item|[;&|<>]/i;
  for (const [name, script] of Object.entries(scripts)) {
    if (unsafe.test(script)) throw new ScaffoldError(`Unsafe package script blocked: ${name}`);
  }
}

function starterFilePackageScripts(files: ScaffoldFile[]) {
  const scripts: Record<string, string>[] = [];
  for (const file of files) {
    if (!file.path.endsWith("package.json")) continue;
    const parsed = safeJson<{ scripts?: Record<string, string> }>(file.content, {});
    if (parsed.scripts) scripts.push(parsed.scripts);
  }
  return scripts;
}

function assertSafeTemplateFiles(rootPath: string, files: ScaffoldFile[]) {
  for (const file of files) {
    validateProposalPath(rootPath, file.path);
    if (file.content.charCodeAt(0) === 0xfeff) throw new ScaffoldError(`Invalid starter file content: ${file.path}`);
  }
  for (const scripts of starterFilePackageScripts(files)) assertSafeScripts(scripts);
}

export function listScaffoldTemplates(db: Database.Database) {
  const rows = db.prepare(`SELECT id,name,description,project_type AS projectType,default_folders_json AS defaultFoldersJson,package_scripts_json AS packageScriptsJson,starter_files_json AS starterFilesJson,recommended_specialist_agents_json AS recommendedSpecialistAgentsJson,risk_level AS riskLevel,allowed_operations_json AS allowedOperationsJson,required_approvals_json AS requiredApprovalsJson,metadata_json AS metadataJson,is_builtin AS isBuiltin,created_at AS createdAt,updated_at AS updatedAt
    FROM scaffold_templates ORDER BY is_builtin DESC,name ASC`).all() as ScaffoldTemplateRow[];
  return rows.map(normalizeTemplate);
}

export function getScaffoldTemplate(db: Database.Database, templateId: string) {
  const row = db.prepare(`SELECT id,name,description,project_type AS projectType,default_folders_json AS defaultFoldersJson,package_scripts_json AS packageScriptsJson,starter_files_json AS starterFilesJson,recommended_specialist_agents_json AS recommendedSpecialistAgentsJson,risk_level AS riskLevel,allowed_operations_json AS allowedOperationsJson,required_approvals_json AS requiredApprovalsJson,metadata_json AS metadataJson,is_builtin AS isBuiltin,created_at AS createdAt,updated_at AS updatedAt
    FROM scaffold_templates WHERE id=?`).get(templateId) as ScaffoldTemplateRow | undefined;
  if (!row) throw new ScaffoldError("Scaffold template not found", 404);
  return normalizeTemplate(row);
}

export function previewScaffoldTemplate(db: Database.Database, templateId: string) {
  const template = getScaffoldTemplate(db, templateId);
  return { template, writesFiles: false };
}

function getWorkspaceRoot(db: Database.Database, workspaceRootId?: string) {
  const row = workspaceRootId
    ? db.prepare("SELECT id,name,root_path AS rootPath,status,is_default AS isDefault FROM workspace_root_config WHERE id=?").get(workspaceRootId)
    : db.prepare("SELECT id,name,root_path AS rootPath,status,is_default AS isDefault FROM workspace_root_config WHERE status='ACTIVE' ORDER BY is_default DESC,created_at ASC LIMIT 1").get();
  const root = row as { id: string; name: string; rootPath: string; status: string; isDefault: number } | undefined;
  if (!root || root.status !== "ACTIVE") throw new ScaffoldError("No active scaffold workspace root is configured", 400);
  return { ...root, rootPath: normalizeProjectRoot(root.rootPath) };
}

function reserveTargetProject(db: Database.Database, input: { projectName: string; targetRootPath: string; now: string }) {
  const incomingKey = projectPathKey(input.targetRootPath);
  const existing = (db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects").all() as ProjectRow[])
    .find((project) => projectPathKey(project.rootPath) === incomingKey);
  if (existing && existing.status !== "DEREGISTERED") throw new ScaffoldError("This project path is already registered or reserved", 409);
  if (existing?.status === "DEREGISTERED") {
    db.prepare("UPDATE projects SET name=?,root_path=?,status='PAUSED',deregistered_at=NULL,deregistered_by=NULL,updated_at=? WHERE id=?")
      .run(input.projectName, input.targetRootPath, input.now, existing.id);
    ensureDefaultProjectSecurityPolicy(db, existing.id, input.now);
    return existing.id;
  }
  const projectId = nanoid();
  db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(projectId, input.projectName, input.targetRootPath, "PAUSED", input.now, input.now);
  ensureDefaultProjectSecurityPolicy(db, projectId, input.now);
  return projectId;
}

function existingActiveProject(db: Database.Database, projectId: string) {
  const project = db.prepare("SELECT id,name,root_path AS rootPath,status FROM projects WHERE id=? AND status='ACTIVE'").get(projectId) as ProjectRow | undefined;
  if (!project) throw new ScaffoldError("Existing active project is required for module scaffolding", 404);
  return project;
}

function prefixedFiles(templateFiles: ScaffoldFile[], prefix: string | null) {
  if (!prefix) return templateFiles;
  return templateFiles.map((file) => ({ ...file, path: `${prefix}/${file.path}` }));
}

export function createScaffoldJob(db: Database.Database, input: {
  id: string;
  templateId: string;
  projectName: string;
  targetDirectoryName?: string;
  workspaceRootId?: string;
  mode: ScaffoldJobMode;
  existingProjectId?: string;
  moduleName?: string;
  planningOnly?: boolean;
  now: string;
  audit: ScaffoldAuditWriter;
}) {
  const template = getScaffoldTemplate(db, input.templateId);
  const planningOnly = Boolean(input.planningOnly);
  const mode = input.mode;
  let projectId: string;
  let targetProjectId: string | null = null;
  let targetRootPath: string;
  let files = template.starterFiles;
  let workspaceRootId: string | null = null;

  if (mode === "ADD_MODULE") {
    if (!input.existingProjectId) throw new ScaffoldError("existingProjectId is required for module scaffolding");
    const project = existingActiveProject(db, input.existingProjectId);
    const modulePrefix = assertRelativeName(input.moduleName ?? slugify(input.projectName), "Module name");
    projectId = project.id;
    targetProjectId = project.id;
    targetRootPath = project.rootPath;
    files = prefixedFiles(files, modulePrefix);
  } else {
    const workspace = getWorkspaceRoot(db, input.workspaceRootId);
    const relativeName = assertRelativeName(input.targetDirectoryName ?? slugify(input.projectName), "Target directory");
    targetRootPath = path.resolve(workspace.rootPath, relativeName);
    assertInside(workspace.rootPath, targetRootPath);
    assertWorkspaceTargetAllowed(db, { workspaceRootPath: workspace.rootPath, targetRootPath, now: input.now, audit: input.audit });
    projectId = reserveTargetProject(db, { projectName: input.projectName, targetRootPath, now: input.now });
    targetProjectId = projectId;
    workspaceRootId = workspace.id;
  }

  assertSafeTemplateFiles(targetRootPath, files);
  const plan = {
    summary: `${template.name}: ${input.projectName}`,
    steps: planningOnly ? ["Review scaffold architecture and target workspace.", "Confirm template before generating file proposals."] : ["Reserve governed project workspace.", "Generate scaffold file proposals.", "Request human approval before apply.", "Apply through proposal pipeline and register project."],
    template: { id: template.id, name: template.name, projectType: template.projectType },
    scaffold: { mode, planningOnly, targetRootPath, fileCount: files.length, recommendedSpecialistAgents: template.recommendedSpecialistAgents },
    starterFiles: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, "utf8") }))
  };
  const taskId = nanoid();
  db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(taskId, projectId, null, "developer", plan.summary, `Scaffold ${input.projectName} from ${template.name}`, planningOnly ? "COMPLETED" : "PLANNING", template.riskLevel, JSON.stringify(plan), "Scaffold proposals reviewed\nNo files written before approval", "Rollback through task rollback if scaffold files are applied.", input.now, input.now);
  const round = createTaskRound(db, {
    taskId,
    userMessage: `Scaffold ${input.projectName} from ${template.name}`,
    summary: plan.summary,
    roundType: "INITIAL",
    status: planningOnly ? "COMPLETED" : "PLANNING",
    context: { scaffoldPlan: plan },
    approvalRequired: !planningOnly,
    nextRequiredAction: planningOnly ? "CONTINUE_CHAT" : "GENERATE_SCAFFOLD_PROPOSALS",
    now: input.now
  });
  if (planningOnly) updateTaskRound(db, round.id, { status: "COMPLETED", completedAt: input.now, recoveryAvailable: false, recoveryStatus: "COMPLETED", recoveryOutcome: "SCAFFOLD_PLANNING_ONLY", now: input.now });
  db.prepare(`INSERT INTO scaffold_jobs (id,template_id,task_id,task_round_id,project_id,target_project_id,target_project_name,target_root_path,workspace_root_id,mode,status,risk_level,planning_only,plan_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.id, template.id, taskId, round.id, projectId, targetProjectId, input.projectName, targetRootPath, workspaceRootId, mode, planningOnly ? "PLANNING_ONLY" : "PLANNED", template.riskLevel, planningOnly ? 1 : 0, JSON.stringify({ ...plan, files }), input.now, input.now);
  input.audit("SCAFFOLD_TEMPLATE_SELECTED", `Scaffold template selected: ${template.name}`, { projectId, taskId, payload: { scaffoldJobId: input.id, templateId: template.id, targetRootPath, mode, planningOnly } });
  return getScaffoldJob(db, input.id);
}

export async function generateScaffoldProposals(db: Database.Database, jobId: string, input: { now: string; audit: ScaffoldAuditWriter; createId?: () => string; planningOnly?: boolean }) {
  const job = getScaffoldJob(db, jobId);
  if (job.status === "PROPOSALS_GENERATED" || job.status === "AWAITING_APPROVAL") return job;
  if (job.planningOnly || input.planningOnly) {
    db.prepare("UPDATE scaffold_jobs SET status='PLANNING_ONLY',planning_only=1,updated_at=?,completed_at=? WHERE id=?").run(input.now, input.now, jobId);
    input.audit("SCAFFOLD_PROPOSALS_GENERATED", "Scaffold planning-only request completed without file proposals", { projectId: job.projectId, taskId: job.taskId, payload: { scaffoldJobId: job.id, planningOnly: true } });
    return getScaffoldJob(db, jobId);
  }
  const template = getScaffoldTemplate(db, job.templateId);
  const plan = safeJson<{ files?: ScaffoldFile[] }>(job.planJson, {});
  const files = plan.files ?? template.starterFiles;
  assertSafeTemplateFiles(job.targetRootPath, files);
  const insertedProposals = [];
  for (const file of files) {
    assertFilePermission(db, { projectId: job.projectId, rootPath: job.targetRootPath, filePath: file.path, action: "FILE_PROPOSAL", operation: "CREATE", proposedContent: file.content, taskId: job.taskId, now: input.now, audit: input.audit });
    const proposal = await insertProposal(db, {
      id: input.createId?.() ?? nanoid(),
      taskId: job.taskId,
      taskRoundId: job.taskRoundId,
      projectId: job.projectId,
      rootPath: job.targetRootPath,
      filePath: file.path,
      operation: "CREATE",
      proposedContent: file.content,
      reason: `Scaffold ${template.name}: create ${file.path}`,
      now: input.now
    });
    insertedProposals.push({ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, reason: proposal.reason });
    db.prepare(`INSERT INTO scaffold_files (id,scaffold_job_id,proposal_id,relative_path,operation,content_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(nanoid(), job.id, proposal.id, proposal.filePath, proposal.operation, proposal.proposedContent ? hashContent(proposal.proposedContent) : null, "PROPOSED", input.now, input.now);
  }
  const assignments = decomposeSpecialistAssignments(db, {
    taskId: job.taskId,
    taskRoundId: job.taskRoundId,
    projectId: job.projectId,
    planSummary: `${template.name}: ${job.targetProjectName}`,
    planSteps: ["Product plan", "Specialist scaffold proposals", "Security and final review"],
    proposals: insertedProposals.map((proposal) => ({ ...proposal, taskRoundId: job.taskRoundId, agentId: null })),
    riskLevel: job.riskLevel,
    now: input.now,
    audit: input.audit
  });
  const ownership = attachSpecialistProposalOwnership(db, { taskId: job.taskId, taskRoundId: job.taskRoundId, now: input.now });
  const approvalId = nanoid();
  db.prepare(`INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(approvalId, job.taskId, job.taskRoundId, "SCAFFOLD_PROPOSALS", `Approve scaffold proposals for ${job.targetProjectName}`, JSON.stringify({ scaffoldJobId: job.id, templateId: template.id, proposals: insertedProposals, assignments, ownership }), job.riskLevel, "PENDING", input.now);
  db.prepare("UPDATE scaffold_jobs SET status='AWAITING_APPROVAL',approval_id=?,updated_at=? WHERE id=?").run(approvalId, input.now, job.id);
  db.prepare("UPDATE tasks SET status='AWAITING_APPROVAL',plan_json=?,updated_at=? WHERE id=?").run(JSON.stringify({ scaffoldJobId: job.id, template, proposals: insertedProposals, assignments, ownership }), input.now, job.taskId);
  updateTaskRound(db, job.taskRoundId, { status: "AWAITING_APPROVAL", proposalCount: insertedProposals.length, nextRequiredAction: "APPROVE_PROPOSALS", now: input.now });
  input.audit("SCAFFOLD_PROPOSALS_GENERATED", `Scaffold proposals generated for ${job.targetProjectName}`, { projectId: job.projectId, taskId: job.taskId, payload: { scaffoldJobId: job.id, proposalCount: insertedProposals.length } });
  input.audit("SCAFFOLD_APPROVAL_REQUESTED", `Scaffold approval requested for ${job.targetProjectName}`, { projectId: job.projectId, taskId: job.taskId, payload: { scaffoldJobId: job.id, approvalId } });
  return getScaffoldJob(db, job.id);
}

export function getScaffoldJob(db: Database.Database, jobId: string) {
  const row = db.prepare(`SELECT id,template_id AS templateId,task_id AS taskId,task_round_id AS taskRoundId,project_id AS projectId,target_project_id AS targetProjectId,target_project_name AS targetProjectName,target_root_path AS targetRootPath,workspace_root_id AS workspaceRootId,mode,status,risk_level AS riskLevel,planning_only AS planningOnly,approval_id AS approvalId,plan_json AS planJson,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt
    FROM scaffold_jobs WHERE id=?`).get(jobId) as any;
  if (!row) throw new ScaffoldError("Scaffold job not found", 404);
  const files = db.prepare("SELECT id,proposal_id AS proposalId,relative_path AS relativePath,operation,content_hash AS contentHash,status,created_at AS createdAt,updated_at AS updatedAt FROM scaffold_files WHERE scaffold_job_id=? ORDER BY relative_path").all(jobId);
  return { ...row, planningOnly: Boolean(row.planningOnly), plan: safeJson(row.planJson, {}), files };
}

export function getScaffoldJobForTask(db: Database.Database, taskId: string) {
  if (!hasTable(db, "scaffold_jobs")) return null;
  const row = db.prepare("SELECT id FROM scaffold_jobs WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string } | undefined;
  return row ? getScaffoldJob(db, row.id) : null;
}

export function markScaffoldApplied(db: Database.Database, taskId: string, now: string, audit: ScaffoldAuditWriter) {
  const job = getScaffoldJobForTask(db, taskId);
  if (!job || job.status === "APPLIED" || job.status === "REGISTERED") return;
  db.prepare("UPDATE scaffold_files SET status='APPLIED',updated_at=? WHERE scaffold_job_id=?").run(now, job.id);
  db.prepare("UPDATE scaffold_jobs SET status='APPLIED',updated_at=?,completed_at=? WHERE id=?").run(now, now, job.id);
  audit("SCAFFOLD_FILES_APPLIED", `Scaffold files applied for ${job.targetProjectName}`, { projectId: job.projectId, taskId, payload: { scaffoldJobId: job.id, targetRootPath: job.targetRootPath } });
  if (job.mode === "CREATE_PROJECT" && job.targetProjectId) {
    db.prepare("UPDATE projects SET status='ACTIVE',paused_at=NULL,updated_at=? WHERE id=?").run(now, job.targetProjectId);
    db.prepare("UPDATE scaffold_jobs SET status='REGISTERED',updated_at=? WHERE id=?").run(now, job.id);
    audit("SCAFFOLD_PROJECT_REGISTERED", `Scaffold project registered: ${job.targetProjectName}`, { projectId: job.targetProjectId, taskId, payload: { scaffoldJobId: job.id, targetRootPath: job.targetRootPath } });
  }
}

export function markScaffoldRolledBack(db: Database.Database, taskId: string, now: string, audit: ScaffoldAuditWriter) {
  const job = getScaffoldJobForTask(db, taskId);
  if (!job) return;
  db.prepare("UPDATE scaffold_files SET status='ROLLED_BACK',updated_at=? WHERE scaffold_job_id=?").run(now, job.id);
  db.prepare("UPDATE scaffold_jobs SET status='ROLLED_BACK',updated_at=? WHERE id=?").run(now, job.id);
  if (job.mode === "CREATE_PROJECT" && job.targetProjectId) {
    db.prepare("UPDATE projects SET status='DEREGISTERED',deregistered_at=?,deregistered_by='scaffold-rollback',updated_at=? WHERE id=?").run(now, now, job.targetProjectId);
  }
  audit("SCAFFOLD_ROLLBACK", `Scaffold rolled back for ${job.targetProjectName}`, { projectId: job.projectId, taskId, payload: { scaffoldJobId: job.id } });
}

export function markScaffoldRecovered(db: Database.Database, taskId: string, now: string, audit: ScaffoldAuditWriter) {
  const job = getScaffoldJobForTask(db, taskId);
  if (!job) return;
  db.prepare("UPDATE scaffold_jobs SET status='RECOVERED',updated_at=? WHERE id=?").run(now, job.id);
  audit("SCAFFOLD_RECOVERY", `Scaffold recovery completed for ${job.targetProjectName}`, { projectId: job.projectId, taskId, payload: { scaffoldJobId: job.id } });
  markScaffoldApplied(db, taskId, now, audit);
}
