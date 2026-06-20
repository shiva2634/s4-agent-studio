import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { nanoid } from "nanoid";
import { createReadStream } from "node:fs";
import { db } from "@s4/db";
import { ApplyMediaTemplateSchema, ApprovalActionSchema, ChatRequestSchema, ClearMediaAssetApprovalSchema, ConvertBuildMissionSchema, CreateAgentSchema, CreateBuildMissionSchema, CreateMediaProjectSchema, CreateProjectFromTemplateSchema, CreateProjectSchema, CreateProposalSchema, CreateScaffoldJobSchema, CreateTaskGitWorkflowSchema, FlowFallbackWanSchema, FlowJobActionSchema, GenerateScaffoldProposalsSchema, GenerateWanSceneSchema, ImportComfyWorkflowSchema, ImportMediaAssetSchema, MediaBrandKitSchema, MediaChatMessageSchema, MediaPresenterProfileSchema, MediaTemplateSchema, PermissionDecisionTestSchema, PolicyChangeRequestSchema, PreviewComfyWorkflowSchema, ProposalActionSchema, RegenerateMediaAssetSchema, RejectMediaAssetSchema, RenameMediaAssetSchema, RenderMediaDraftSchema, RenderMediaExportSchema, ReorderMediaScenesSchema, RestoreMediaSceneVersionSchema, RetryWanGenerationSchema, ReuseMediaPromptVersionSchema, RouteMediaGenerationSchema, SelectMediaDefaultsSchema, UpdateComfyWorkflowSchema, UpdateMediaAudioSettingsSchema, UpdateMediaBriefSchema, UpdateMediaProjectSchema, UpdateMediaSceneSchema } from "@s4/shared";
import { classifyRisk, isMutationRequest, isReadOnlyInspectionRequest, requiresApproval } from "./policy.js";
import { createPlan } from "./planner.js";
import { inspectProject } from "./project-inspection.js";
import { listProjectTree, readProjectFile } from "./project-files.js";
import { assertReadableProjectFilePath, insertProposal } from "./change-proposals.js";
import { analyzeTask, formatPlanningOnlyResponse } from "./task-analysis.js";
import { loadProviderConfig, providerStatusResponse, sanitizeProviderError, validateCodeProposalOutput } from "./ai-provider.js";
import { createAiProvider, getProviderStatus, testConfiguredProvider } from "./provider-factory.js";
import { buildCodeProposalInput } from "./proposal-context.js";
import { applyTaskProposals, getTaskExecution, recoverTaskExecution, rollbackTask, runTaskChecks } from "./proposal-execution.js";
import { ProjectRegistrationError, archiveProject, deregisterProject, listActiveProjects, listManageableProjects, pauseProject, registerOrReactivateProject, resumeProject } from "./project-registration.js";
import { MediaStudioError, addDirectorChatMessage, applyMediaTemplateToProject, approveGeneratedMediaAsset, approveMediaBrief, approveMediaScene, archiveMediaProject, archiveMediaTemplate, clearGeneratedMediaAssetApproval, createBrandKit, createMediaProject, createMediaProjectFromTemplate, createMediaTemplate, createPresenterProfile, deleteBrandKit, deleteLibraryAsset, deleteMediaChatMessage, deletePresenterProfile, deleteProjectAsset, deleteSceneAsset, duplicateMediaTemplate, exportMediaProductionPackage, getMediaAssetApproval, getMediaAssetForDownload, getMediaProjectBundle, getPromptVersion, getSceneFlowPrompt, getSceneVersion, importSceneAsset, listMediaProjects, listMediaTemplates, listPromptVersions, listSceneVersions, mediaAssetMaxBytes, mediaProviderRegistry, previewMediaTemplate, rejectGeneratedMediaAsset, rejectMediaScene, renameMediaAsset, reorderMediaScenes, replaceLibraryAsset, replaceSceneAsset, restoreSceneVersion, selectMediaLibraryDefaults, selectProjectBackgroundMusic, updateAudioAssetSettings, updateBrandKit, updateMediaBrief, updateMediaProject, updateMediaScene, updateMediaTemplate, updatePresenterProfile, uploadLibraryAsset, uploadProjectAsset, uploadSceneAsset } from "./media-studio.js";
import { detectFfmpeg, getMediaDerivativeForDownload, listProcessingJobs, processMediaAsset } from "./media-processing.js";
import { cancelRenderJob, listRenderJobs, renderDraftVideo, renderProductionExport, retryProductionExport, validateExportReadiness } from "./media-rendering.js";
import { activateComfyWorkflow, comfyStatusResponse, deleteComfyWorkflow, importComfyWorkflow, listComfyWorkflows, loadComfyConfig, previewCompiledWorkflow, testComfyConnection, updateComfyWorkflow, wanImageToVideoWorkflowTemplate, wanTextToVideoWorkflowTemplate } from "./comfyui-provider.js";
import { cancelFlowJob, fallbackFlowJobToWan, getFlowPackage, getMediaProviderCapabilities, importFlowGeneratedAsset, markFlowGenerated, rejectFlowJob, retryFlowJob, selectMediaProviders, type MediaProviderTask } from "./media-provider-router.js";
import { loadLongCatConfig, longCatStatusResponse, testLongCatConnection } from "./longcat-provider.js";
import { NvidiaVideoDirectorProvider } from "./media-director-provider.js";
import { externalProviderStatusResponse, loadLtxConfig, loadOviConfig, testExternalProviderConnection } from "./ovi-ltx-provider.js";
import { listGenerationStatusHistory } from "./media-generation-history.js";
import { MediaGenerationWorker, getGenerationJob, loadGenerationWorkerConfig } from "./media-generation-worker.js";
import { buildTaskContext, createTaskRound, getCurrentTaskRound, listTaskHistory, summarizeTaskState, updateTaskRound } from "./task-workflow.js";
import { attachSpecialistProposalOwnership, decomposeSpecialistAssignments, listSpecialistAgents, reassignTaskAssignment, updateAssignmentLifecycle, type SpecialistAssignmentAction } from "./specialist-orchestration.js";
import { ScaffoldError, createScaffoldJob, generateScaffoldProposals, getScaffoldJob, listScaffoldTemplates, previewScaffoldTemplate } from "./scaffold-engine.js";
import { PermissionDeniedError, assertFilePermission, assertNetworkAllowed, assertProjectActiveForPolicy, assertProviderAllowed, classifyCommandRisk, getProjectSecurityPolicy, listPermissionEvents, listPermissionProfiles, requestProjectPolicyChange, resolveProjectPolicyApproval, sanitizeForPolicy } from "./security-policy.js";
import { GitWorkflowError, applyApprovedProposalsToGitWorkflow, cleanupTaskWorktree, createReleaseCandidate, createTaskGitWorkflow, getProjectGitStatus, getTaskGitWorkflowStatus, mergeApprovedReleaseCandidate, recoverGitWorkflow, requestMergeApproval, rollbackGitWorkflow, runGitWorkflowChecks } from "./git-workflow.js";
import { SelfBuildReadinessError, convertApprovedBuildMission, createBuildMissionDraft, getBuildMission, getLatestReadinessReport, getReadinessReport, listBuildMissionEvents, listBuildMissions, listReadinessHistory, requestBuildMissionApproval, resolveBuildMissionApproval, runSelfBuildReadiness } from "./self-build-readiness.js";
import { registerBusinessAuthRoutes } from "./business-auth.js";
import { registerBusinessControlCentreRoutes } from "./business-control-centre-routes.js";
import { registerAppStudioInternalRoutes } from "./app-studio-internal-routes.js";

const app = Fastify({ logger: true });
const allowedOrigins = new Set((process.env.S4_WEB_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((origin) => origin.trim()).filter(Boolean));
await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("CORS origin is not allowed"), false);
  }
});
await app.register(multipart, {
  limits: { fileSize: mediaAssetMaxBytes, files: 1 }
});
const now = () => new Date().toISOString();
const mediaProviderTasks = ["T2V", "I2V", "PRESENTER", "AUDIO_VIDEO"] as const;

function audit(eventType: string, summary: string, values: { projectId?: string; taskId?: string; agentId?: string; payload?: unknown } = {}) {
  const cleanSummary = sanitizeForPolicy(db, summary, { projectId: values.projectId, taskId: values.taskId, source: "audit-summary" });
  const cleanPayload = values.payload ? JSON.parse(sanitizeForPolicy(db, JSON.stringify(values.payload), { projectId: values.projectId, taskId: values.taskId, source: "audit-payload" })) : null;
  db.prepare(`INSERT INTO audit_events (id,project_id,task_id,agent_id,event_type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(nanoid(), values.projectId ?? null, values.taskId ?? null, values.agentId ?? null, eventType, cleanSummary, cleanPayload ? JSON.stringify(cleanPayload) : null, now());
}

function parsePayload(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function createSpecialistApproval(input: { taskId: string; taskRoundId: string | null; actionType: string; summary: string; payload: unknown; riskLevel: string; timestamp: string }) {
  const approvalId = nanoid();
  db.prepare(`INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(approvalId, input.taskId, input.taskRoundId, input.actionType, input.summary, JSON.stringify(input.payload), input.riskLevel, "PENDING", input.timestamp);
  return approvalId;
}

const generationWorker = new MediaGenerationWorker(db, audit, loadGenerationWorkerConfig());

function isMediaProviderTask(value: string): value is MediaProviderTask {
  return mediaProviderTasks.includes(value as MediaProviderTask);
}

app.get("/health", async () => ({ status: "ok", service: "s4-agent-studio-api", time: now() }));

registerBusinessAuthRoutes(app);
registerBusinessControlCentreRoutes(app);
registerAppStudioInternalRoutes(app);

app.get("/api/providers/status", async () => getProviderStatus());

app.post("/api/providers/test", async (_request, reply) => {
  try {
    return await testConfiguredProvider();
  } catch (error) {
    return reply.status(502).send({ ...getProviderStatus(), status: "error", sanitizedError: sanitizeProviderError(error) });
  }
});

app.get("/api/bootstrap", async () => ({
  product: "App Studio",
  projects: listActiveProjects(db),
  manageableProjects: listManageableProjects(db),
  agents: db.prepare("SELECT id,name,role,purpose,instructions,status,project_id AS projectId,capabilities_json AS capabilitiesJson,allowed_tools_json AS allowedToolsJson FROM agents ORDER BY created_at").all(),
  pendingApprovals: db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status='PENDING'").get()
}));

app.get("/api/specialist-agents", async (request: any) => ({
  agents: listSpecialistAgents(db, typeof request.query?.projectId === "string" ? request.query.projectId : null)
}));

app.get("/api/media/providers", async () => ({ providers: mediaProviderRegistry }));

app.get("/api/media/director/status", async () => providerStatusResponse(loadProviderConfig()));

app.post("/api/media/director/test", async () => {
  const config = loadProviderConfig();
  const provider = new NvidiaVideoDirectorProvider(config);
  const health = await provider.testConnection();
  return providerStatusResponse(config, health);
});

app.get("/api/media/provider-router", async (request: any, reply) => {
  const capabilities = getMediaProviderCapabilities(loadComfyConfig(), loadLongCatConfig(), loadOviConfig(), loadLtxConfig());
  const task = typeof request.query?.task === "string" ? request.query.task : undefined;
  if (task && !isMediaProviderTask(task)) return reply.status(400).send({ error: "Invalid provider task" });
  return {
    capabilities,
    decision: task ? selectMediaProviders(task, capabilities) : null
  };
});

app.get("/api/media/ffmpeg/status", async () => detectFfmpeg());

app.get("/api/media/comfyui/status", async () => comfyStatusResponse(loadComfyConfig()));

app.post("/api/media/comfyui/test", async () => testComfyConnection(loadComfyConfig()));

app.get("/api/media/longcat/status", async () => longCatStatusResponse(loadLongCatConfig()));

app.post("/api/media/longcat/test", async () => testLongCatConnection(loadLongCatConfig()));

app.get("/api/media/ovi/status", async () => externalProviderStatusResponse(loadOviConfig()));

app.post("/api/media/ovi/test", async () => testExternalProviderConnection("ovi", loadOviConfig()));

app.get("/api/media/ltx/status", async () => externalProviderStatusResponse(loadLtxConfig()));

app.post("/api/media/ltx/test", async () => testExternalProviderConnection("ltx", loadLtxConfig()));

app.get("/api/media/comfyui/workflows", async () => ({
  templates: {
    wanTextToVideo: wanTextToVideoWorkflowTemplate,
    wanImageToVideo: wanImageToVideoWorkflowTemplate
  }
}));

app.get("/api/media/projects", async (request: any) => ({
  projects: listMediaProjects(db, request.query?.includeArchived === "true")
}));

app.get("/api/media/templates", async (request: any) => ({
  templates: listMediaTemplates(db, request.query?.includeArchived === "true")
}));

app.post("/api/media/templates", async (request: any, reply) => {
  const parsed = MediaTemplateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media template", details: parsed.error.flatten() });
  try {
    return reply.status(201).send({ template: createMediaTemplate(db, { id: nanoid(), ...parsed.data, now: now() }, audit) });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create media template" });
  }
});

app.put("/api/media/templates/:templateId", async (request: any, reply) => {
  const parsed = MediaTemplateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media template", details: parsed.error.flatten() });
  try {
    return { template: updateMediaTemplate(db, request.params.templateId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update media template" });
  }
});

app.post("/api/media/templates/:templateId/duplicate", async (request: any, reply) => {
  try {
    return reply.status(201).send({ template: duplicateMediaTemplate(db, request.params.templateId, { id: nanoid(), now: now(), name: typeof request.body?.name === "string" ? request.body.name : undefined }, audit) });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to duplicate media template" });
  }
});

app.delete("/api/media/templates/:templateId", async (request: any, reply) => {
  try {
    return { template: archiveMediaTemplate(db, request.params.templateId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to archive media template" });
  }
});

app.get("/api/media/templates/:templateId/preview", async (request: any, reply) => {
  try {
    return previewMediaTemplate(db, request.params.templateId);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to preview media template" });
  }
});

app.post("/api/media/projects", async (request, reply) => {
  const parsed = CreateMediaProjectSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media project", details: parsed.error.flatten() });
  try {
    const project = createMediaProject(db, { id: nanoid(), name: parsed.data.name, description: parsed.data.description, now: now() }, audit);
    return reply.status(201).send({ project });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create media project" });
  }
});

app.post("/api/media/templates/:templateId/projects", async (request: any, reply) => {
  const parsed = CreateProjectFromTemplateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid template project", details: parsed.error.flatten() });
  try {
    const project = createMediaProjectFromTemplate(db, request.params.templateId, { id: nanoid(), ...parsed.data, now: now() }, audit);
    return reply.status(201).send({ project });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create media project from template" });
  }
});

app.get("/api/media/projects/:projectId", async (request: any, reply) => {
  try {
    return { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load media project" });
  }
});

app.get("/api/media/projects/:projectId/comfy-workflows", async (request: any, reply) => {
  try {
    return { workflows: listComfyWorkflows(db, request.params.projectId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load ComfyUI workflows" });
  }
});

app.post("/api/media/projects/:projectId/comfy-workflows", async (request: any, reply) => {
  const parsed = ImportComfyWorkflowSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid ComfyUI workflow", details: parsed.error.flatten() });
  try {
    const workflow = importComfyWorkflow(db, request.params.projectId, { id: nanoid(), name: parsed.data.name, workflowType: parsed.data.workflowType, workflowJson: parsed.data.workflowJson, mapping: parsed.data.mapping, activate: parsed.data.activate, now: now() }, audit);
    return reply.status(201).send({ workflow });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to import ComfyUI workflow" });
  }
});

app.put("/api/media/projects/:projectId/comfy-workflows/:workflowId", async (request: any, reply) => {
  const parsed = UpdateComfyWorkflowSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid ComfyUI workflow update", details: parsed.error.flatten() });
  try {
    const workflow = updateComfyWorkflow(db, request.params.projectId, request.params.workflowId, { id: nanoid(), name: parsed.data.name, workflowJson: parsed.data.workflowJson, mapping: parsed.data.mapping, activate: parsed.data.activate, now: now() }, audit);
    return reply.status(201).send({ workflow });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update ComfyUI workflow" });
  }
});

app.delete("/api/media/projects/:projectId/comfy-workflows/:workflowId", async (request: any, reply) => {
  try {
    return deleteComfyWorkflow(db, request.params.projectId, request.params.workflowId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete ComfyUI workflow" });
  }
});

app.post("/api/media/projects/:projectId/comfy-workflows/:workflowId/activate", async (request: any, reply) => {
  try {
    return { workflow: activateComfyWorkflow(db, request.params.projectId, request.params.workflowId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to activate ComfyUI workflow" });
  }
});

app.post("/api/media/projects/:projectId/comfy-workflows/preview", async (request: any, reply) => {
  const parsed = PreviewComfyWorkflowSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid ComfyUI workflow preview", details: parsed.error.flatten() });
  try {
    return previewCompiledWorkflow(db, request.params.projectId, parsed.data);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to preview ComfyUI workflow" });
  }
});

app.patch("/api/media/projects/:projectId", async (request: any, reply) => {
  const parsed = UpdateMediaProjectSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media project update", details: parsed.error.flatten() });
  try {
    return { project: updateMediaProject(db, request.params.projectId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update media project" });
  }
});

app.post("/api/media/projects/:projectId/templates/:templateId/apply", async (request: any, reply) => {
  const parsed = ApplyMediaTemplateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid template application", details: parsed.error.flatten() });
  try {
    return applyMediaTemplateToProject(db, request.params.projectId, request.params.templateId, { ...parsed.data, now: now(), createId: nanoid }, audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to apply media template" });
  }
});

app.post("/api/media/projects/:projectId/brand-kits", async (request: any, reply) => {
  const parsed = MediaBrandKitSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid brand kit", details: parsed.error.flatten() });
  try {
    return reply.status(201).send({ brandKit: createBrandKit(db, request.params.projectId, { id: nanoid(), ...parsed.data, now: now() }, audit) });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create brand kit" });
  }
});

app.put("/api/media/projects/:projectId/brand-kits/:brandKitId", async (request: any, reply) => {
  const parsed = MediaBrandKitSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid brand kit", details: parsed.error.flatten() });
  try {
    return { brandKit: updateBrandKit(db, request.params.projectId, request.params.brandKitId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update brand kit" });
  }
});

app.delete("/api/media/projects/:projectId/brand-kits/:brandKitId", async (request: any, reply) => {
  try {
    return deleteBrandKit(db, request.params.projectId, request.params.brandKitId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete brand kit" });
  }
});

app.post("/api/media/projects/:projectId/presenter-profiles", async (request: any, reply) => {
  const parsed = MediaPresenterProfileSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid presenter profile", details: parsed.error.flatten() });
  try {
    return reply.status(201).send({ presenterProfile: createPresenterProfile(db, request.params.projectId, { id: nanoid(), ...parsed.data, now: now() }, audit) });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create presenter profile" });
  }
});

app.put("/api/media/projects/:projectId/presenter-profiles/:presenterProfileId", async (request: any, reply) => {
  const parsed = MediaPresenterProfileSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid presenter profile", details: parsed.error.flatten() });
  try {
    return { presenterProfile: updatePresenterProfile(db, request.params.projectId, request.params.presenterProfileId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update presenter profile" });
  }
});

app.delete("/api/media/projects/:projectId/presenter-profiles/:presenterProfileId", async (request: any, reply) => {
  try {
    return deletePresenterProfile(db, request.params.projectId, request.params.presenterProfileId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete presenter profile" });
  }
});

app.patch("/api/media/projects/:projectId/library-defaults", async (request: any, reply) => {
  const parsed = SelectMediaDefaultsSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media library defaults", details: parsed.error.flatten() });
  try {
    return { project: selectMediaLibraryDefaults(db, request.params.projectId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to select media library defaults" });
  }
});

app.delete("/api/media/projects/:projectId", async (request: any, reply) => {
  try {
    return { project: archiveMediaProject(db, request.params.projectId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to archive media project" });
  }
});

app.get("/api/media/projects/:projectId/messages", async (request: any, reply) => {
  try {
    return { messages: getMediaProjectBundle(db, request.params.projectId).messages };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load media messages" });
  }
});

app.post("/api/media/projects/:projectId/messages", async (request: any, reply) => {
  const parsed = MediaChatMessageSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media chat message", details: parsed.error.flatten() });
  try {
    const providerConfig = loadProviderConfig();
    const directorProvider = providerConfig.configured ? new NvidiaVideoDirectorProvider(providerConfig) : null;
    return await addDirectorChatMessage(db, {
      projectId: request.params.projectId,
      message: parsed.data.message,
      replaceApproved: parsed.data.replaceApproved,
      regenerateSceneId: parsed.data.regenerateSceneId,
      now: now(),
      createId: nanoid,
      directorProvider
    }, audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to save media chat message" });
  }
});

app.delete("/api/media/projects/:projectId/messages/:messageId", async (request: any, reply) => {
  try {
    return deleteMediaChatMessage(db, request.params.projectId, request.params.messageId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete media chat message" });
  }
});

app.patch("/api/media/projects/:projectId/brief", async (request: any, reply) => {
  const parsed = UpdateMediaBriefSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media brief", details: parsed.error.flatten() });
  try {
    return { brief: updateMediaBrief(db, request.params.projectId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update media brief" });
  }
});

app.post("/api/media/projects/:projectId/brief/approve", async (request: any, reply) => {
  try {
    return { brief: approveMediaBrief(db, request.params.projectId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to approve media brief" });
  }
});

app.patch("/api/media/projects/:projectId/scenes/:sceneId", async (request: any, reply) => {
  const parsed = UpdateMediaSceneSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media scene", details: parsed.error.flatten() });
  try {
    return { scene: updateMediaScene(db, request.params.projectId, request.params.sceneId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update media scene" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/approve", async (request: any, reply) => {
  try {
    return { scene: approveMediaScene(db, request.params.projectId, request.params.sceneId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to approve media scene" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/reject", async (request: any, reply) => {
  try {
    return { scene: rejectMediaScene(db, request.params.projectId, request.params.sceneId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reject media scene" });
  }
});

app.post("/api/media/projects/:projectId/scenes/reorder", async (request: any, reply) => {
  const parsed = ReorderMediaScenesSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid scene order", details: parsed.error.flatten() });
  try {
    return { scenes: reorderMediaScenes(db, request.params.projectId, parsed.data.sceneIds, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reorder scenes" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/flow-prompt", async (request: any, reply) => {
  try {
    return getSceneFlowPrompt(db, request.params.projectId, request.params.sceneId);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to generate Flow prompt" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/versions", async (request: any, reply) => {
  try {
    return { versions: listSceneVersions(db, request.params.projectId, request.params.sceneId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to list scene versions" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/versions/:versionId", async (request: any, reply) => {
  try {
    return { version: getSceneVersion(db, request.params.projectId, request.params.sceneId, request.params.versionId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load scene version" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/versions/:versionId/restore", async (request: any, reply) => {
  const parsed = RestoreMediaSceneVersionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid scene version restore", details: parsed.error.flatten() });
  if (!parsed.data.approved) return reply.status(403).send({ error: "Restoring a scene version requires approval" });
  try {
    const scene = restoreSceneVersion(db, request.params.projectId, request.params.sceneId, request.params.versionId, { now: now(), createdBy: "local-user", changeSummary: parsed.data.changeSummary }, audit);
    return { scene, versions: listSceneVersions(db, request.params.projectId, request.params.sceneId), bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to restore scene version" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/prompt-versions", async (request: any, reply) => {
  try {
    return { versions: listPromptVersions(db, request.params.projectId, request.params.sceneId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to list prompt versions" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/prompt-versions/:versionId", async (request: any, reply) => {
  try {
    return { version: getPromptVersion(db, request.params.projectId, request.params.sceneId, request.params.versionId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load prompt version" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/prompt-versions/:versionId/reuse", async (request: any, reply) => {
  const parsed = ReuseMediaPromptVersionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid prompt reuse request", details: parsed.error.flatten() });
  try {
    const version = getPromptVersion(db, request.params.projectId, request.params.sceneId, request.params.versionId);
    const job = generationWorker.enqueueGeneration({
      projectId: request.params.projectId,
      sceneId: request.params.sceneId,
      task: version.taskType as any,
      providerKey: version.providerKey === "router" ? undefined : version.providerKey as any,
      approved: parsed.data.approved,
      paidProviderApproved: parsed.data.paidProviderApproved,
      maxAttempts: parsed.data.maxAttempts,
      promptVersionId: version.id,
      referenceAssetIds: parsed.data.referenceAssetIds,
      regenerationReason: parsed.data.regenerationReason,
      now: now()
    });
    return reply.status(202).send({ job });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reuse prompt version" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/generate/wan", async (request: any, reply) => {
  const parsed = GenerateWanSceneSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid Wan generation request", details: parsed.error.flatten() });
  try {
    const job = generationWorker.enqueueGeneration({
      projectId: request.params.projectId,
      sceneId: request.params.sceneId,
      task: parsed.data.mode === "image-to-video" ? "I2V" : "T2V",
      providerKey: "wan-2.2",
      approved: parsed.data.approved,
      fps: parsed.data.fps,
      seed: parsed.data.seed,
      promptVersionId: parsed.data.promptVersionId,
      referenceAssetIds: parsed.data.referenceAssetIds,
      regenerationReason: parsed.data.regenerationReason,
      now: now()
    });
    return reply.status(202).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to queue Wan media generation" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/generate", async (request: any, reply) => {
  const parsed = RouteMediaGenerationSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid provider routing request", details: parsed.error.flatten() });
  try {
    const job = generationWorker.enqueueGeneration({
      projectId: request.params.projectId,
      sceneId: request.params.sceneId,
      task: parsed.data.task,
      providerKey: parsed.data.providerKey,
      approved: parsed.data.approved,
      paidProviderApproved: parsed.data.paidProviderApproved,
      maxAttempts: parsed.data.maxAttempts,
      fps: parsed.data.fps,
      seed: parsed.data.seed,
      promptVersionId: parsed.data.promptVersionId,
      referenceAssetIds: parsed.data.referenceAssetIds,
      regenerationReason: parsed.data.regenerationReason,
      now: now()
    });
    return reply.status(202).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to queue media generation" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/assets", async (request: any, reply) => {
  const parsed = ImportMediaAssetSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid media asset", details: parsed.error.flatten() });
  try {
    const asset = importSceneAsset(db, request.params.projectId, request.params.sceneId, { ...parsed.data, id: nanoid(), now: now() }, audit);
    return reply.status(201).send({ asset });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to import media asset" });
  }
});

app.get("/api/media/projects/:projectId/scenes/:sceneId/assets", async (request: any, reply) => {
  try {
    const bundle = getMediaProjectBundle(db, request.params.projectId);
    return { assets: bundle.assets.filter((asset) => asset.sceneId === request.params.sceneId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load media assets" });
  }
});

app.post("/api/media/projects/:projectId/scenes/:sceneId/assets/upload", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Upload requires one image or video file" });
    const bytes = await file.toBuffer();
    const asset = await uploadSceneAsset(db, request.params.projectId, request.params.sceneId, {
      id: nanoid(),
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to upload media asset" });
  }
});

app.post("/api/media/projects/:projectId/assets/upload", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Upload requires one media file" });
    const bytes = await file.toBuffer();
    const audioRole = typeof request.query?.audioRole === "string" ? request.query.audioRole : undefined;
    const parsedAudioRole = audioRole === "NARRATION" || audioRole === "MUSIC" || audioRole === "SFX" || audioRole === "SCENE_AUDIO" ? audioRole : undefined;
    const asset = await uploadProjectAsset(db, request.params.projectId, {
      id: nanoid(),
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      audioRole: parsedAudioRole,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to upload project asset" });
  }
});

app.post("/api/media/projects/:projectId/brand-kits/:brandKitId/assets/upload", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Upload requires one image file" });
    const bytes = await file.toBuffer();
    const asset = await uploadLibraryAsset(db, request.params.projectId, {
      id: nanoid(),
      ownerType: "brand",
      ownerId: request.params.brandKitId,
      role: typeof request.query?.role === "string" ? request.query.role : "logo",
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to upload brand asset" });
  }
});

app.post("/api/media/projects/:projectId/presenter-profiles/:presenterProfileId/assets/upload", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Upload requires one image file" });
    const bytes = await file.toBuffer();
    const asset = await uploadLibraryAsset(db, request.params.projectId, {
      id: nanoid(),
      ownerType: "presenter",
      ownerId: request.params.presenterProfileId,
      role: typeof request.query?.role === "string" ? request.query.role : "reference",
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to upload presenter asset" });
  }
});

app.patch("/api/media/projects/:projectId/assets/:assetId/audio", async (request: any, reply) => {
  const parsed = UpdateMediaAudioSettingsSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid audio settings", details: parsed.error.flatten() });
  try {
    return { asset: updateAudioAssetSettings(db, request.params.projectId, request.params.assetId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to update audio settings" });
  }
});

app.post("/api/media/projects/:projectId/background-music", async (request: any, reply) => {
  const assetId = typeof request.body?.assetId === "string" ? request.body.assetId : null;
  try {
    return selectProjectBackgroundMusic(db, request.params.projectId, assetId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to select background music" });
  }
});

app.put("/api/media/projects/:projectId/scenes/:sceneId/assets/:assetId", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Replacement requires one image or video file" });
    const bytes = await file.toBuffer();
    const asset = await replaceSceneAsset(db, request.params.projectId, request.params.sceneId, request.params.assetId, {
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return { asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to replace media asset" });
  }
});

app.put("/api/media/projects/:projectId/library-assets/:assetId", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Replacement requires one image file" });
    const bytes = await file.toBuffer();
    const asset = await replaceLibraryAsset(db, request.params.projectId, request.params.assetId, {
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    const processing = await processMediaAsset(db, request.params.projectId, asset.id, { jobId: nanoid(), now: now() }, audit);
    return { asset: getMediaProjectBundle(db, request.params.projectId).assets.find((item) => item.id === asset.id) ?? asset, processing };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Uploaded asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to replace library asset" });
  }
});

app.delete("/api/media/projects/:projectId/library-assets/:assetId", async (request: any, reply) => {
  try {
    return await deleteLibraryAsset(db, request.params.projectId, request.params.assetId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete library asset" });
  }
});

app.get("/api/media/projects/:projectId/assets/:assetId/:derivative", async (request: any, reply) => {
  if (!["thumbnail", "preview"].includes(request.params.derivative)) return reply.status(404).send({ error: "Media derivative not found" });
  try {
    const derivative = getMediaDerivativeForDownload(db, request.params.projectId, request.params.assetId, request.params.derivative);
    return reply.type(derivative.mimeType).send(createReadStream(derivative.localPath));
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to download media derivative" });
  }
});

app.get("/api/media/projects/:projectId/assets/:assetId/download", async (request: any, reply) => {
  try {
    const asset = getMediaAssetForDownload(db, request.params.projectId, request.params.assetId);
    reply.header("content-disposition", `inline; filename="${asset.fileName ?? asset.originalName ?? "asset"}"`);
    return reply.type(asset.mimeType ?? "application/octet-stream").send(createReadStream(asset.localPath as string));
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to download media asset" });
  }
});

app.delete("/api/media/projects/:projectId/scenes/:sceneId/assets/:assetId", async (request: any, reply) => {
  try {
    return await deleteSceneAsset(db, request.params.projectId, request.params.sceneId, request.params.assetId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete media asset" });
  }
});

app.get("/api/media/projects/:projectId/render-jobs", async (request: any, reply) => {
  try {
    return { renderJobs: listRenderJobs(db, request.params.projectId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load render jobs" });
  }
});

app.post("/api/media/projects/:projectId/render", async (request: any, reply) => {
  const parsed = RenderMediaDraftSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid render request", details: parsed.error.flatten() });
  try {
    const job = await renderDraftVideo(db, request.params.projectId, { ...parsed.data, jobId: nanoid(), outputAssetId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to render draft video" });
  }
});

app.post("/api/media/projects/:projectId/exports/preflight", async (request: any, reply) => {
  const parsed = RenderMediaExportSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid export preflight request", details: parsed.error.flatten() });
  try {
    return validateExportReadiness(db, request.params.projectId, parsed.data);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to validate export readiness" });
  }
});

app.post("/api/media/projects/:projectId/exports", async (request: any, reply) => {
  const parsed = RenderMediaExportSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid export request", details: parsed.error.flatten() });
  try {
    const job = await renderProductionExport(db, request.params.projectId, { ...parsed.data, jobId: nanoid(), outputAssetId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to render final export" });
  }
});

app.post("/api/media/projects/:projectId/render-jobs/:jobId/retry-export", async (request: any, reply) => {
  try {
    const job = await retryProductionExport(db, request.params.projectId, request.params.jobId, { jobId: nanoid(), outputAssetId: nanoid(), now: now() }, audit);
    return reply.status(201).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to retry final export" });
  }
});

app.patch("/api/media/projects/:projectId/assets/:assetId", async (request: any, reply) => {
  const parsed = RenameMediaAssetSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid asset rename", details: parsed.error.flatten() });
  try {
    return { asset: renameMediaAsset(db, request.params.projectId, request.params.assetId, { ...parsed.data, now: now() }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to rename media asset" });
  }
});

app.get("/api/media/projects/:projectId/assets/:assetId/approval", async (request: any, reply) => {
  try {
    return { approval: getMediaAssetApproval(db, request.params.projectId, request.params.assetId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load asset approval" });
  }
});

app.post("/api/media/projects/:projectId/assets/:assetId/approve", async (request: any, reply) => {
  try {
    const asset = approveGeneratedMediaAsset(db, request.params.projectId, request.params.assetId, { now: now(), actor: "local-user" }, audit);
    return { asset, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to approve generated asset" });
  }
});

app.post("/api/media/projects/:projectId/assets/:assetId/reject", async (request: any, reply) => {
  const parsed = RejectMediaAssetSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid asset rejection", details: parsed.error.flatten() });
  try {
    const asset = rejectGeneratedMediaAsset(db, request.params.projectId, request.params.assetId, { feedback: parsed.data.feedback, now: now(), actor: "local-user" }, audit);
    return { asset, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reject generated asset" });
  }
});

app.post("/api/media/projects/:projectId/assets/:assetId/approval/reset", async (request: any, reply) => {
  const parsed = ClearMediaAssetApprovalSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid approval reset", details: parsed.error.flatten() });
  try {
    return { asset: clearGeneratedMediaAssetApproval(db, request.params.projectId, request.params.assetId, { now: now(), reason: parsed.data.reason }, audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reset generated asset approval" });
  }
});

app.post("/api/media/projects/:projectId/assets/:assetId/regenerate", async (request: any, reply) => {
  const parsed = RegenerateMediaAssetSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid asset regeneration request", details: parsed.error.flatten() });
  try {
    const source = db.prepare("SELECT scene_id AS sceneId,source FROM media_assets WHERE id=? AND media_project_id=?").get(request.params.assetId, request.params.projectId) as { sceneId: string | null; source: string } | undefined;
    if (!source?.sceneId || !["comfyui-wan", "longcat-avatar", "ovi", "ltx", "google-flow"].includes(source.source)) throw new MediaStudioError("Generated scene asset not found", 404);
    const references = [...new Set([request.params.assetId, ...(parsed.data.referenceAssetIds ?? [])])];
    const job = generationWorker.enqueueGeneration({
      projectId: request.params.projectId,
      sceneId: source.sceneId,
      task: parsed.data.task,
      providerKey: parsed.data.providerKey,
      approved: parsed.data.approved,
      paidProviderApproved: parsed.data.paidProviderApproved,
      maxAttempts: parsed.data.maxAttempts,
      referenceAssetIds: references,
      regenerationReason: parsed.data.regenerationReason,
      now: now()
    });
    return reply.status(202).send({ job });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to queue asset regeneration" });
  }
});

app.delete("/api/media/projects/:projectId/assets/:assetId", async (request: any, reply) => {
  try {
    return await deleteProjectAsset(db, request.params.projectId, request.params.assetId, now(), audit);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to delete media asset" });
  }
});

app.post("/api/media/projects/:projectId/render-jobs/:jobId/cancel", async (request: any, reply) => {
  try {
    return { job: cancelRenderJob(db, request.params.projectId, request.params.jobId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to cancel render job" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/cancel", async (request: any, reply) => {
  try {
    const job = db.prepare("SELECT provider_key AS providerKey FROM media_generation_jobs WHERE id=? AND media_project_id=?").get(request.params.jobId, request.params.projectId) as { providerKey: string } | undefined;
    if (job?.providerKey === "google-flow") return { job: cancelFlowJob(db, request.params.projectId, request.params.jobId, now(), audit) };
    return { job: generationWorker.cancel(request.params.projectId, request.params.jobId, now()) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to cancel generation job" });
  }
});

app.get("/api/media/projects/:projectId/generation-jobs/:jobId", async (request: any, reply) => {
  try {
    return { job: getGenerationJob(db, request.params.projectId, request.params.jobId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load generation job" });
  }
});

app.get("/api/media/projects/:projectId/generation-jobs/:jobId/status-history", async (request: any, reply) => {
  try {
    return { history: listGenerationStatusHistory(db, request.params.projectId, request.params.jobId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load generation job status history" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/retry", async (request: any, reply) => {
  const parsed = RetryWanGenerationSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid Wan retry request", details: parsed.error.flatten() });
  try {
    const existing = db.prepare("SELECT provider_key AS providerKey FROM media_generation_jobs WHERE id=? AND media_project_id=?").get(request.params.jobId, request.params.projectId) as { providerKey: string } | undefined;
    if (existing?.providerKey === "google-flow") {
      const job = retryFlowJob(db, request.params.projectId, request.params.jobId, { jobId: nanoid(), now: now() }, audit);
      return reply.status(201).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
    }
    const job = generationWorker.retry(request.params.projectId, request.params.jobId, { jobId: nanoid(), now: now(), approved: parsed.data.approved });
    return reply.status(202).send({ job, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to retry generation job" });
  }
});

app.get("/api/media/projects/:projectId/generation-jobs/:jobId/flow-package", async (request: any, reply) => {
  try {
    return { package: getFlowPackage(db, request.params.projectId, request.params.jobId) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load Flow package" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/flow-generated", async (request: any, reply) => {
  try {
    return { job: markFlowGenerated(db, request.params.projectId, request.params.jobId, now(), audit) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to mark Flow job generated" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/reject", async (request: any, reply) => {
  const parsed = FlowJobActionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid Flow reject request", details: parsed.error.flatten() });
  try {
    return { job: rejectFlowJob(db, request.params.projectId, request.params.jobId, now(), audit, parsed.data.note) };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to reject Flow job" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/fallback-wan", async (request: any, reply) => {
  const parsed = FlowFallbackWanSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid Wan fallback request", details: parsed.error.flatten() });
  try {
    const result = await fallbackFlowJobToWan(db, request.params.projectId, request.params.jobId, {
      jobId: nanoid(),
      outputAssetId: nanoid(),
      now: now(),
      approved: parsed.data.approved
    }, audit);
    return reply.status(201).send({ ...result, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to fallback Flow job to Wan" });
  }
});

app.post("/api/media/projects/:projectId/generation-jobs/:jobId/import-flow", async (request: any, reply) => {
  try {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Flow import requires one generated image or video file" });
    const bytes = await file.toBuffer();
    const result = await importFlowGeneratedAsset(db, request.params.projectId, request.params.jobId, {
      assetId: nanoid(),
      processingJobId: nanoid(),
      originalName: file.filename,
      mimeType: file.mimetype,
      bytes,
      now: now()
    }, audit);
    return reply.status(201).send({ ...result, bundle: { ...getMediaProjectBundle(db, request.params.projectId), processingJobs: listProcessingJobs(db, request.params.projectId), renderJobs: listRenderJobs(db, request.params.projectId), comfyWorkflows: listComfyWorkflows(db, request.params.projectId) } });
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Error && error.message.toLowerCase().includes("too large")) return reply.status(413).send({ error: "Imported Flow asset exceeds the size limit" });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to import Flow asset" });
  }
});

app.get("/api/media/projects/:projectId/export", async (request: any, reply) => {
  try {
    return exportMediaProductionPackage(db, request.params.projectId, now());
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to export media package" });
  }
});

app.post("/api/projects", async (request, reply) => {
  const parsed = CreateProjectSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid project", details: parsed.error.flatten() });
  const id = nanoid();
  const timestamp = now();
  try {
    const project = registerOrReactivateProject(db, { id, name: parsed.data.name, rootPath: parsed.data.rootPath, now: timestamp }, audit);
    return reply.status(project.reactivated ? 200 : 201).send(project);
  } catch (error) {
    if (error instanceof ProjectRegistrationError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to register project" });
  }
});

app.get("/api/permission-profiles", async () => ({ profiles: listPermissionProfiles(db) }));

app.get("/api/projects/:projectId/security-policy", async (request: any, reply) => {
  try {
    const policy = getProjectSecurityPolicy(db, request.params.projectId);
    return {
      project: { id: policy.project.id, name: policy.project.name, status: policy.project.status },
      permissionProfileId: policy.permissionProfileId,
      profileName: policy.profileName,
      sandboxEnabled: policy.sandboxEnabled,
      networkEnabled: policy.networkEnabled,
      providerCallsEnabled: policy.providerCallsEnabled,
      secretsBlocked: policy.secretsBlocked,
      providerPolicy: policy.providerPolicy,
      costPolicy: policy.costPolicy,
      networkAllowlist: db.prepare("SELECT id,host,reason,status,created_at AS createdAt FROM network_allowlist WHERE project_id=? ORDER BY host").all(request.params.projectId)
    };
  } catch (error) {
    return reply.status(404).send({ error: error instanceof Error ? error.message : "Security policy not found" });
  }
});

app.post("/api/projects/:projectId/security-policy/change-requests", async (request: any, reply) => {
  const parsed = PolicyChangeRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid policy change request", details: parsed.error.flatten() });
  try {
    const result = requestProjectPolicyChange(db, { id: nanoid(), approvalId: nanoid(), projectId: request.params.projectId, profileId: parsed.data.profileId, reason: parsed.data.reason, now: now(), audit });
    return reply.status(result.approvalRequired ? 202 : 200).send(result);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return reply.status(403).send({ error: error.message });
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to request policy change" });
  }
});

app.get("/api/projects/:projectId/permission-events", async (request: any) => ({ events: listPermissionEvents(db, request.params.projectId) }));

app.post("/api/projects/:projectId/permissions/test", async (request: any, reply) => {
  const parsed = PermissionDecisionTestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid permission test", details: parsed.error.flatten() });
  try {
    const project = db.prepare("SELECT id,root_path AS rootPath FROM projects WHERE id=?").get(request.params.projectId) as { id: string; rootPath: string } | undefined;
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (parsed.data.action === "FILE_READ" || parsed.data.action === "FILE_PROPOSAL") assertFilePermission(db, { projectId: project.id, rootPath: project.rootPath, filePath: parsed.data.filePath ?? "package.json", action: parsed.data.action, now: now(), audit });
    else if (parsed.data.action === "NETWORK_ACCESS") assertNetworkAllowed(db, { projectId: project.id, host: parsed.data.host ?? "", now: now(), audit });
    else if (parsed.data.action === "COMMAND") {
      const riskClass = classifyCommandRisk(parsed.data.command ?? "");
      if (riskClass === "destructive" || riskClass === "network") throw new PermissionDeniedError(`${riskClass} commands are blocked`);
    } else if (parsed.data.action === "PROVIDER_CALL") {
      const providerConfig = loadProviderConfig();
      assertProviderAllowed(db, { projectId: project.id, provider: parsed.data.provider ?? providerConfig.provider, configured: providerConfig.configured, now: now(), audit });
    }
    return { decision: "ALLOW" };
  } catch (error) {
    return reply.status(error instanceof PermissionDeniedError && error.decision === "APPROVAL_REQUIRED" ? 202 : 403).send({ decision: error instanceof PermissionDeniedError ? error.decision : "DENY", error: error instanceof Error ? error.message : "Permission denied" });
  }
});

app.post("/api/projects/:projectId/self-build/readiness/run", async (request: any, reply) => {
  try {
    return { report: await runSelfBuildReadiness(db, { id: nanoid(), projectId: request.params.projectId, now: now(), audit }) };
  } catch (error) {
    if (error instanceof SelfBuildReadinessError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to run self-build readiness validation" });
  }
});

app.get("/api/projects/:projectId/self-build/readiness/latest", async (request: any) => ({
  report: getLatestReadinessReport(db, request.params.projectId)
}));

app.get("/api/projects/:projectId/self-build/readiness/history", async (request: any) => ({
  runs: listReadinessHistory(db, request.params.projectId)
}));

app.get("/api/self-build/readiness/:runId", async (request: any, reply) => {
  try {
    return { report: getReadinessReport(db, request.params.runId) };
  } catch (error) {
    if (error instanceof SelfBuildReadinessError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load readiness report" });
  }
});

app.post("/api/projects/:projectId/build-missions", async (request: any, reply) => {
  const parsed = CreateBuildMissionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid build mission", details: parsed.error.flatten() });
  try {
    const mission = createBuildMissionDraft(db, { id: nanoid(), projectId: request.params.projectId, ...parsed.data, now: now(), audit });
    return reply.status(201).send({ mission });
  } catch (error) {
    if (error instanceof SelfBuildReadinessError || error instanceof PermissionDeniedError) return reply.status(error instanceof SelfBuildReadinessError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create build mission" });
  }
});

app.get("/api/projects/:projectId/build-missions", async (request: any) => ({
  missions: listBuildMissions(db, request.params.projectId)
}));

app.get("/api/build-missions/:missionId", async (request: any, reply) => {
  try {
    return { mission: getBuildMission(db, request.params.missionId) };
  } catch (error) {
    if (error instanceof SelfBuildReadinessError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load build mission" });
  }
});

app.post("/api/build-missions/:missionId/approval", async (request: any, reply) => {
  try {
    return requestBuildMissionApproval(db, request.params.missionId, { approvalId: nanoid(), now: now(), audit });
  } catch (error) {
    if (error instanceof SelfBuildReadinessError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to request build mission approval" });
  }
});

app.post("/api/build-missions/:missionId/convert", async (request: any, reply) => {
  const parsed = ConvertBuildMissionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid build mission conversion", details: parsed.error.flatten() });
  try {
    return { mission: convertApprovedBuildMission(db, request.params.missionId, { gitMode: parsed.data.gitMode, now: now(), audit }) };
  } catch (error) {
    if (error instanceof SelfBuildReadinessError || error instanceof PermissionDeniedError) return reply.status(error instanceof SelfBuildReadinessError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to convert build mission" });
  }
});

app.get("/api/build-missions/:missionId/events", async (request: any) => ({
  events: listBuildMissionEvents(db, request.params.missionId)
}));

app.get("/api/projects/:projectId/git/status", async (request: any, reply) => {
  try {
    return await getProjectGitStatus(db, request.params.projectId, now());
  } catch (error) {
    if (error instanceof GitWorkflowError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to inspect Git status" });
  }
});

app.get("/api/tasks/:taskId/git-workflow", async (request: any) => ({
  gitWorkflow: getTaskGitWorkflowStatus(db, request.params.taskId)
}));

app.post("/api/tasks/:taskId/git-workflow", async (request: any, reply) => {
  const parsed = CreateTaskGitWorkflowSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid Git workflow request", details: parsed.error.flatten() });
  try {
    return { gitWorkflow: await createTaskGitWorkflow(db, request.params.taskId, { mode: parsed.data.mode, worktreeName: parsed.data.worktreeName, now: now(), audit }) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create task Git workflow" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/apply", async (request: any, reply) => {
  try {
    return { gitWorkflow: await applyApprovedProposalsToGitWorkflow(db, request.params.taskId, now(), audit) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to apply proposals to task Git workflow" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/checks", async (request: any, reply) => {
  try {
    return await runGitWorkflowChecks(db, request.params.taskId, now(), audit);
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to run Git workflow checks" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/release-candidate", async (request: any, reply) => {
  try {
    return { gitWorkflow: await createReleaseCandidate(db, request.params.taskId, now(), audit) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to create release candidate" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/merge-approval", async (request: any, reply) => {
  try {
    return requestMergeApproval(db, request.params.taskId, now(), audit);
  } catch (error) {
    if (error instanceof GitWorkflowError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to request merge approval" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/merge", async (request: any, reply) => {
  try {
    return { gitWorkflow: await mergeApprovedReleaseCandidate(db, request.params.taskId, now(), audit) };
  } catch (error) {
    audit("GIT_MERGE_BLOCKED", error instanceof Error ? error.message : "Merge blocked", { taskId: request.params.taskId });
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to merge release candidate" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/rollback", async (request: any, reply) => {
  try {
    return { gitWorkflow: await rollbackGitWorkflow(db, request.params.taskId, now(), audit) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to roll back Git workflow" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/cleanup", async (request: any, reply) => {
  try {
    return { gitWorkflow: await cleanupTaskWorktree(db, request.params.taskId, now(), audit) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to clean up worktree" });
  }
});

app.post("/api/tasks/:taskId/git-workflow/recover", async (request: any, reply) => {
  try {
    return { gitWorkflow: await recoverGitWorkflow(db, request.params.taskId, now(), audit) };
  } catch (error) {
    if (error instanceof GitWorkflowError || error instanceof PermissionDeniedError) return reply.status(error instanceof GitWorkflowError ? error.statusCode : 403).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to recover Git workflow" });
  }
});

app.get("/api/scaffold/templates", async () => ({
  templates: listScaffoldTemplates(db).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    projectType: template.projectType,
    defaultFolders: template.defaultFolders,
    packageScripts: template.packageScripts,
    recommendedSpecialistAgents: template.recommendedSpecialistAgents,
    riskLevel: template.riskLevel,
    allowedOperations: template.allowedOperations,
    requiredApprovals: template.requiredApprovals,
    starterFileCount: template.starterFiles.length,
    isBuiltin: template.isBuiltin
  }))
}));

app.get("/api/scaffold/templates/:templateId/preview", async (request: any, reply) => {
  try {
    return previewScaffoldTemplate(db, request.params.templateId);
  } catch (error) {
    if (error instanceof ScaffoldError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to preview scaffold template" });
  }
});

app.post("/api/scaffold/jobs", async (request: any, reply) => {
  const parsed = CreateScaffoldJobSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid scaffold job", details: parsed.error.flatten() });
  try {
    const job = createScaffoldJob(db, { id: nanoid(), ...parsed.data, now: now(), audit });
    return reply.status(201).send({ job });
  } catch (error) {
    if (error instanceof ScaffoldError) {
      audit("SCAFFOLD_BLOCKED", error.message, { payload: { request: parsed.data } });
      return reply.status(error.statusCode).send({ error: error.message });
    }
    return reply.status(500).send({ error: "Unable to create scaffold job" });
  }
});

app.post("/api/scaffold/jobs/:jobId/proposals", async (request: any, reply) => {
  const parsed = GenerateScaffoldProposalsSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid scaffold proposal request", details: parsed.error.flatten() });
  try {
    return { job: await generateScaffoldProposals(db, request.params.jobId, { now: now(), audit, planningOnly: parsed.data.planningOnly }) };
  } catch (error) {
    if (error instanceof ScaffoldError) {
      audit("SCAFFOLD_BLOCKED", error.message, { payload: { jobId: request.params.jobId } });
      return reply.status(error.statusCode).send({ error: error.message });
    }
    return reply.status(500).send({ error: "Unable to generate scaffold proposals" });
  }
});

app.get("/api/scaffold/jobs/:jobId", async (request: any, reply) => {
  try {
    return { job: getScaffoldJob(db, request.params.jobId) };
  } catch (error) {
    if (error instanceof ScaffoldError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load scaffold job" });
  }
});

app.post("/api/scaffold/jobs/:jobId/apply", async (request: any, reply) => {
  try {
    const job = getScaffoldJob(db, request.params.jobId);
    const result = await applyTaskProposals(db, job.taskId, now(), audit);
    return { job: getScaffoldJob(db, request.params.jobId), result };
  } catch (error) {
    if (error instanceof ScaffoldError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to apply scaffold proposals" });
  }
});

app.delete("/api/projects/:projectId", async (request: any, reply) => {
  try {
    return deregisterProject(db, request.params.projectId, now(), audit);
  } catch (error) {
    if (error instanceof ProjectRegistrationError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to de-register project" });
  }
});

app.post("/api/projects/:projectId/pause", async (request: any, reply) => {
  try {
    return pauseProject(db, request.params.projectId, now(), audit);
  } catch (error) {
    if (error instanceof ProjectRegistrationError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to pause project" });
  }
});

app.post("/api/projects/:projectId/resume", async (request: any, reply) => {
  try {
    return resumeProject(db, request.params.projectId, now(), audit);
  } catch (error) {
    if (error instanceof ProjectRegistrationError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to resume project" });
  }
});

app.post("/api/projects/:projectId/archive", async (request: any, reply) => {
  try {
    return archiveProject(db, request.params.projectId, now(), audit);
  } catch (error) {
    if (error instanceof ProjectRegistrationError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to archive project" });
  }
});

app.get("/api/projects/:projectId/tree", async (request: any, reply) => {
  const project = db.prepare("SELECT id,root_path AS rootPath FROM projects WHERE id=? AND status='ACTIVE'").get(request.params.projectId) as any;
  if (!project) return reply.status(404).send({ error: "Project not found" });
  try {
    assertFilePermission(db, { projectId: project.id, rootPath: project.rootPath, filePath: request.query?.path && request.query.path !== "." ? request.query.path : "package.json", action: "FILE_READ", now: now(), audit });
    return { entries: await listProjectTree(project.rootPath, request.query?.path ?? ".", 2) };
  }
  catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to inspect project" }); }
});

app.get("/api/projects/:projectId/file", async (request: any, reply) => {
  const project = db.prepare("SELECT id,root_path AS rootPath FROM projects WHERE id=? AND status='ACTIVE'").get(request.params.projectId) as any;
  if (!project) return reply.status(404).send({ error: "Project not found" });
  try {
    assertFilePermission(db, { projectId: project.id, rootPath: project.rootPath, filePath: request.query.path, action: "FILE_READ", now: now(), audit });
    assertReadableProjectFilePath(project.rootPath, request.query.path);
    const content = await readProjectFile(project.rootPath, request.query.path);
    return { path: request.query.path, content: sanitizeForPolicy(db, content, { projectId: project.id, source: "file-read", now: now(), audit }) };
  }
  catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to read file" }); }
});

app.post("/api/chat", async (request, reply) => {
  const parsed = ChatRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  const project = db.prepare("SELECT id,name,root_path AS rootPath FROM projects WHERE id=? AND status='ACTIVE'").get(parsed.data.projectId) as any;
  if (!project) return reply.status(404).send({ error: "Select or register a project first" });
  const timestamp = now();
  const currentTask = parsed.data.taskId ? db.prepare("SELECT t.id,t.conversation_id AS conversationId,t.status,t.title,t.objective,t.plan_json AS planJson,t.acceptance_criteria AS acceptanceCriteria,t.rollback_plan AS rollbackPlan FROM tasks t WHERE t.id=? AND t.project_id=?").get(parsed.data.taskId, project.id) as { id: string; conversationId: string | null; status: string; title: string; objective: string; planJson: string; acceptanceCriteria: string | null; rollbackPlan: string | null } | undefined : undefined;
  if (parsed.data.taskId && !currentTask) return reply.status(404).send({ error: "Task not found" });
  if (parsed.data.taskId && currentTask?.conversationId && parsed.data.conversationId && parsed.data.conversationId !== currentTask.conversationId) return reply.status(400).send({ error: "Conversation does not match the selected task" });
  const conversationTitle = currentTask?.title ?? parsed.data.message.slice(0, 80);
  const conversationId = currentTask?.conversationId ?? parsed.data.conversationId ?? nanoid();
  if (currentTask?.id && !currentTask.conversationId) {
    db.prepare("INSERT INTO conversations (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(conversationId, project.id, conversationTitle, timestamp, timestamp);
    db.prepare("UPDATE tasks SET conversation_id=?,updated_at=? WHERE id=?").run(conversationId, timestamp, currentTask.id);
  } else if (!currentTask?.id && !parsed.data.conversationId) {
    db.prepare("INSERT INTO conversations (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(conversationId, project.id, conversationTitle, timestamp, timestamp);
  }
  db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
    .run(nanoid(), conversationId, "user", parsed.data.message, timestamp);

  if (isReadOnlyInspectionRequest(parsed.data.message)) {
    const riskLevel = classifyRisk(parsed.data.message);
    const taskId = currentTask?.id ?? nanoid();
    const { inspection, report } = await inspectProject(project.rootPath);
    const plan = {
      summary: `Read-only inspection for: ${parsed.data.message.slice(0, 120)}`,
      steps: [],
      requiredApproval: false,
      rollback: "No rollback required. This task is read-only.",
      acceptanceCriteria: ["Inspection report returned", "No project files modified"],
      inspectionResult: inspection
    };
    if (!currentTask) {
      db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, project.id, conversationId, "developer", plan.summary, parsed.data.message, "COMPLETED", riskLevel, JSON.stringify(plan), plan.acceptanceCriteria.join("\n"), plan.rollback, timestamp, timestamp);
    } else {
      db.prepare("UPDATE tasks SET title=?,objective=?,status=?,risk_level=?,plan_json=?,acceptance_criteria=?,rollback_plan=?,updated_at=? WHERE id=?")
        .run(plan.summary, parsed.data.message, "COMPLETED", riskLevel, JSON.stringify(plan), plan.acceptanceCriteria.join("\n"), plan.rollback, timestamp, taskId);
    }
    const taskRound = createTaskRound(db, {
      taskId,
      userMessage: parsed.data.message,
      summary: plan.summary,
      roundType: currentTask ? (["FAILED", "FAILED_VALIDATION", "ROLLED_BACK"].includes(currentTask.status) ? "CORRECTION" : "CONTINUATION") : "INITIAL",
      status: "COMPLETED",
      context: { inspection, inspectionResult: inspection, previousTask: currentTask ? { id: currentTask.id, status: currentTask.status } : null },
      approvalRequired: false,
      nextRequiredAction: "CONTINUE_CHAT",
      now: timestamp
    });
    updateTaskRound(db, taskRound.id, { status: "COMPLETED", nextRequiredAction: "CONTINUE_CHAT", completedAt: timestamp, recoveryAvailable: false, recoveryStatus: "COMPLETED", recoveryOutcome: "READ_ONLY_INSPECTION", now: timestamp });
    db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
      .run(nanoid(), conversationId, "agent", report, now());
    audit("READ_ONLY_INSPECTION_COMPLETED", `Read-only inspection completed for ${project.name}`, { projectId: project.id, taskId, agentId: "developer", payload: { riskLevel, inspection } });
    return { conversationId, taskId, approvalId: null, agent: "Developer Agent", response: report, riskLevel, approvalRequired: false, plan, nextStep: "COMPLETED" };
  }

  const riskLevel = classifyRisk(parsed.data.message);
  if (isMutationRequest(parsed.data.message)) {
    const { inspection } = await inspectProject(project.rootPath);
    const providerConfig = loadProviderConfig();
    const analysis = await analyzeTask(project.rootPath, parsed.data.message, inspection, providerConfig.configured);
    const taskId = currentTask?.id ?? nanoid();
    const planningOnly = analysis.mode === "PLANNING_ONLY";
    const mutationPlan = {
      summary: `${analysis.featureCategory}: ${parsed.data.message.slice(0, 120)}`,
      steps: analysis.implementationPlan,
      requiredApproval: analysis.approvalRequired,
      inspectionResult: inspection,
      analysis,
      expectedFiles: [] as string[],
      proposals: [] as Array<{ id: string; filePath: string; operation: string; reason: string }>,
      acceptanceCriteria: analysis.acceptanceCriteria,
      rollback: "No project files were changed. Reject this plan or revise the request before any code proposal is generated."
    };
    if (!currentTask) {
      db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, project.id, conversationId, "developer", mutationPlan.summary, parsed.data.message, "PLANNING", analysis.riskLevel, JSON.stringify(mutationPlan), mutationPlan.acceptanceCriteria.join("\n"), mutationPlan.rollback, timestamp, timestamp);
    }
    const taskRound = createTaskRound(db, {
      taskId,
      userMessage: parsed.data.message,
      summary: mutationPlan.summary,
      roundType: currentTask ? (["FAILED", "FAILED_VALIDATION", "ROLLED_BACK"].includes(currentTask.status) ? "CORRECTION" : "CONTINUATION") : "INITIAL",
      status: "PLANNING",
      context: {
        inspection,
        analysis,
        previousTask: currentTask ? { id: currentTask.id, status: currentTask.status, title: currentTask.title } : null
      },
      approvalRequired: analysis.approvalRequired,
      nextRequiredAction: "CONTINUE_CHAT",
      now: timestamp
    });
    const taskContext = buildTaskContext(db, taskId);
    if (!planningOnly) {
      try {
        assertProviderAllowed(db, { projectId: project.id, taskId, provider: providerConfig.provider, configured: providerConfig.configured, now: timestamp, audit });
        const provider = createAiProvider(providerConfig);
        const input = await buildCodeProposalInput(project.rootPath, project.name, parsed.data.message, inspection, analysis, {
          maximumFiles: providerConfig.maxProposalFiles,
          maximumOutputBytes: providerConfig.maxOutputBytes,
          taskContext
        });
        const rawOutput = await provider.generateCodeProposal(input);
        const output = validateCodeProposalOutput(rawOutput, project.rootPath, {
          maximumFiles: providerConfig.maxProposalFiles,
          maximumOutputBytes: providerConfig.maxOutputBytes
        });
        mutationPlan.summary = output.summary;
        mutationPlan.steps = output.plan;
        mutationPlan.acceptanceCriteria = analysis.acceptanceCriteria;
        mutationPlan.expectedFiles = output.proposals.map((proposal) => proposal.relativePath);
        db.prepare("UPDATE tasks SET title=?,objective=?,status=?,risk_level=?,plan_json=?,acceptance_criteria=?,rollback_plan=?,updated_at=? WHERE id=?")
          .run(mutationPlan.summary, parsed.data.message, "AWAITING_APPROVAL", analysis.riskLevel, JSON.stringify(mutationPlan), mutationPlan.acceptanceCriteria.join("\n"), mutationPlan.rollback, timestamp, taskId);
        const insertedProposals = [];
        try {
          for (const providerProposal of output.proposals) {
            const proposal = await insertProposal(db, {
              id: nanoid(),
              taskId,
              taskRoundId: taskRound.id,
              projectId: project.id,
              rootPath: project.rootPath,
              filePath: providerProposal.relativePath,
              operation: providerProposal.operation,
              proposedContent: providerProposal.proposedContent,
              reason: providerProposal.reason,
              now: timestamp
            });
            insertedProposals.push({ id: proposal.id, filePath: proposal.filePath, operation: proposal.operation, reason: proposal.reason });
          }
        } catch (error) {
          db.prepare("DELETE FROM change_proposals WHERE task_id=?").run(taskId);
          throw error;
        }
        mutationPlan.proposals = insertedProposals;
        const assignments = decomposeSpecialistAssignments(db, {
          taskId,
          taskRoundId: taskRound.id,
          projectId: project.id,
          planSummary: mutationPlan.summary,
          planSteps: mutationPlan.steps,
          proposals: insertedProposals.map((proposal) => ({ ...proposal, taskRoundId: taskRound.id, agentId: null })),
          riskLevel: analysis.riskLevel,
          now: timestamp,
          audit
        });
        const ownership = attachSpecialistProposalOwnership(db, { taskId, taskRoundId: taskRound.id, now: timestamp });
        const specialistRiskLevel = assignments.some((assignment) => assignment.role === "DATABASE") ? "high" : analysis.riskLevel;
        const specialistPlan = { ...mutationPlan, specialistAssignments: assignments.map((assignment) => ({ id: assignment.id, role: assignment.role, status: assignment.status, priority: assignment.priority, riskLevel: assignment.riskLevel })), proposalOwnership: ownership };
        db.prepare("UPDATE tasks SET plan_json=?,updated_at=? WHERE id=?").run(JSON.stringify({ ...mutationPlan, provider: { provider: providerConfig.provider, model: providerConfig.model } }), timestamp, taskId);
        db.prepare("UPDATE tasks SET risk_level=?,plan_json=?,updated_at=? WHERE id=?").run(specialistRiskLevel, JSON.stringify({ ...specialistPlan, provider: { provider: providerConfig.provider, model: providerConfig.model } }), timestamp, taskId);
        const approvalId = nanoid();
        db.prepare(`INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(approvalId, taskId, taskRound.id, "CHANGE_PROPOSAL", `Approve generated proposals for: ${mutationPlan.summary}`, JSON.stringify({ plan: specialistPlan, provider: { provider: providerConfig.provider, model: providerConfig.model } }), specialistRiskLevel, "PENDING", timestamp);
        updateTaskRound(db, taskRound.id, { status: "AWAITING_APPROVAL", proposalCount: insertedProposals.length, nextRequiredAction: "APPROVE_PROPOSALS", now: timestamp });
        const responseText = sanitizeForPolicy(db, [
          `I inspected ${project.name} and generated code proposals for review.`,
          "",
          `Provider: ${providerConfig.provider}`,
          `Model: ${providerConfig.model}`,
          `Risk level: ${specialistRiskLevel}`,
          `Specialist assignments: ${assignments.length}`,
          "Approval required: Yes.",
          "No files were modified.",
          "",
          "Affected files:",
          ...insertedProposals.map((proposal) => `- ${proposal.operation} ${proposal.filePath}`),
          "",
          "Warnings:",
          ...(output.warnings.length ? output.warnings.map((warning) => `- ${warning}`) : ["- None"])
        ].join("\n"), { projectId: project.id, taskId, source: "chat-response", now: timestamp, audit });
        db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
          .run(nanoid(), conversationId, "agent", responseText, now());
        audit("CODE_PROPOSAL_CREATED", `Code proposals created for ${project.name}`, { projectId: project.id, taskId, agentId: "developer", payload: { riskLevel: specialistRiskLevel, provider: providerConfig.provider, model: providerConfig.model, proposalCount: insertedProposals.length, assignmentCount: assignments.length } });
        return { conversationId, taskId, approvalId, agent: "Developer Agent", response: responseText, riskLevel: specialistRiskLevel, approvalRequired: true, plan: specialistPlan, nextStep: "AWAITING_APPROVAL" };
      } catch (error) {
        const sanitizedError = sanitizeForPolicy(db, sanitizeProviderError(error), { projectId: project.id, taskId, source: "provider-error", now: timestamp, audit });
        const failedPlan = { ...mutationPlan, providerError: sanitizedError };
        db.prepare("UPDATE tasks SET title=?,objective=?,status=?,risk_level=?,plan_json=?,acceptance_criteria=?,rollback_plan=?,updated_at=? WHERE id=?")
          .run(failedPlan.summary, parsed.data.message, "FAILED", analysis.riskLevel, JSON.stringify(failedPlan), failedPlan.acceptanceCriteria.join("\n"), failedPlan.rollback, timestamp, taskId);
        updateTaskRound(db, taskRound.id, { status: "FAILED", nextRequiredAction: "CONTINUE_CHAT", completedAt: timestamp, recoveryAvailable: false, recoveryStatus: "FAILED", recoveryOutcome: "PROPOSAL_GENERATION_FAILED", now: timestamp });
        const responseText = `Code proposal generation failed: ${sanitizedError}\n\nNo files were modified.`;
        db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
          .run(nanoid(), conversationId, "agent", responseText, now());
        audit("CODE_PROPOSAL_FAILED", "Code proposal generation failed", { projectId: project.id, taskId, agentId: "developer", payload: { riskLevel: analysis.riskLevel, provider: providerConfig.provider, model: providerConfig.model, sanitizedError } });
        return { conversationId, taskId, approvalId: null, agent: "Developer Agent", response: responseText, riskLevel: analysis.riskLevel, approvalRequired: false, plan: failedPlan, nextStep: "FAILED" };
      }
    }

    db.prepare("UPDATE tasks SET title=?,objective=?,status=?,risk_level=?,plan_json=?,acceptance_criteria=?,rollback_plan=?,updated_at=? WHERE id=?")
      .run(mutationPlan.summary, parsed.data.message, "AWAITING_APPROVAL", analysis.riskLevel, JSON.stringify(mutationPlan), mutationPlan.acceptanceCriteria.join("\n"), mutationPlan.rollback, timestamp, taskId);
    const assignments = decomposeSpecialistAssignments(db, {
      taskId,
      taskRoundId: taskRound.id,
      projectId: project.id,
      planSummary: mutationPlan.summary,
      planSteps: mutationPlan.steps,
      proposals: [],
      riskLevel: analysis.riskLevel,
      now: timestamp,
      audit
    });
    const planningPlan = { ...mutationPlan, specialistAssignments: assignments.map((assignment) => ({ id: assignment.id, role: assignment.role, status: assignment.status, priority: assignment.priority, riskLevel: assignment.riskLevel })) };
    db.prepare("UPDATE tasks SET plan_json=?,updated_at=? WHERE id=?").run(JSON.stringify(planningPlan), timestamp, taskId);
    const approvalId = nanoid();
    db.prepare(`INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(approvalId, taskId, taskRound.id, "PLANNING_ONLY", `Approve plan for: ${mutationPlan.summary}`, JSON.stringify({ plan: planningPlan }), analysis.riskLevel, "PENDING", timestamp);
    updateTaskRound(db, taskRound.id, { status: "AWAITING_APPROVAL", nextRequiredAction: "APPROVE_PROPOSALS", now: timestamp });
    const responseText = formatPlanningOnlyResponse(project.name, analysis);
    db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
      .run(nanoid(), conversationId, "agent", responseText, now());
    audit(planningOnly ? "PLANNING_ONLY_CREATED" : "CODE_PROPOSAL_PENDING_PROVIDER", `Plan created for ${project.name}`, { projectId: project.id, taskId, agentId: "developer", payload: { riskLevel: analysis.riskLevel, inspection, analysis, assignmentCount: assignments.length } });
    return { conversationId, taskId, approvalId, agent: "Developer Agent", response: responseText, riskLevel: analysis.riskLevel, approvalRequired: analysis.approvalRequired, plan: planningPlan, nextStep: "AWAITING_APPROVAL" };
  }

  const plan = createPlan(parsed.data.message, riskLevel);
  const taskId = currentTask?.id ?? nanoid();
  const taskStatus = requiresApproval(riskLevel) ? "AWAITING_APPROVAL" : "PLANNING";
  if (!currentTask) {
    db.prepare(`INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,acceptance_criteria,rollback_plan,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, project.id, conversationId, "developer", plan.summary, parsed.data.message, taskStatus, riskLevel, JSON.stringify(plan), plan.acceptanceCriteria.join("\n"), plan.rollback, timestamp, timestamp);
  } else {
    db.prepare("UPDATE tasks SET title=?,objective=?,status=?,risk_level=?,plan_json=?,acceptance_criteria=?,rollback_plan=?,updated_at=? WHERE id=?")
      .run(plan.summary, parsed.data.message, taskStatus, riskLevel, JSON.stringify(plan), plan.acceptanceCriteria.join("\n"), plan.rollback, timestamp, taskId);
  }
  const taskRound = createTaskRound(db, {
    taskId,
    userMessage: parsed.data.message,
    summary: plan.summary,
    roundType: currentTask ? (["FAILED", "FAILED_VALIDATION", "ROLLED_BACK"].includes(currentTask.status) ? "CORRECTION" : "CONTINUATION") : "INITIAL",
    status: taskStatus as "PLANNING" | "AWAITING_APPROVAL",
    context: { plan, previousTask: currentTask ? { id: currentTask.id, status: currentTask.status } : null },
    approvalRequired: Boolean(requiresApproval(riskLevel)),
    nextRequiredAction: requiresApproval(riskLevel) ? "APPROVE_PROPOSALS" : "CONTINUE_CHAT",
    now: timestamp
  });
  let approvalId: string | null = null;
  if (requiresApproval(riskLevel)) {
    approvalId = nanoid();
    db.prepare(`INSERT INTO approvals (id,task_id,task_round_id,action_type,summary,payload_json,risk_level,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(approvalId, taskId, taskRound.id, "PLAN_EXECUTION", `Approve execution of: ${plan.summary}`, JSON.stringify({ plan }), riskLevel, "PENDING", timestamp);
  }
  const responseText = `I created a ${plan.steps.length}-step plan for ${project.name}. ${requiresApproval(riskLevel) ? "The plan is waiting for your approval before sensitive work begins." : "I can continue with safe inspection and planning."}`;
  db.prepare("INSERT INTO messages (id,conversation_id,sender,content,created_at) VALUES (?,?,?,?,?)")
    .run(nanoid(), conversationId, "agent", responseText, now());
  audit("TASK_CREATED", responseText, { projectId: project.id, taskId, agentId: "developer", payload: { riskLevel, plan } });
  return { conversationId, taskId, approvalId, agent: "Developer Agent", response: responseText, riskLevel, approvalRequired: Boolean(approvalId), plan, nextStep: taskStatus };
});

app.get("/api/conversations/:conversationId/messages", async (request: any) => ({
  messages: (db.prepare("SELECT id,sender,content,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at").all(request.params.conversationId) as Array<{ id: string; sender: string; content: string; createdAt: string }>).map((message) => ({ ...message, content: sanitizeForPolicy(db, message.content, { source: "conversation-message" }) }))
}));

app.get("/api/tasks", async (request: any) => ({
  tasks: db.prepare(`SELECT t.id,t.project_id AS projectId,t.title,t.objective,t.status,t.risk_level AS riskLevel,t.plan_json AS planJson,t.created_at AS createdAt,p.name AS projectName
    FROM tasks t JOIN projects p ON p.id=t.project_id ORDER BY t.created_at DESC LIMIT 100`).all().map((task: any) => ({
      ...task,
      ...summarizeTaskState(db, task.id)
    }))
}));

app.get("/api/approvals", async () => ({
  approvals: (db.prepare(`SELECT a.id,a.task_id AS taskId,a.action_type AS actionType,a.summary,a.payload_json AS payloadJson,a.risk_level AS riskLevel,a.status,a.created_at AS createdAt,t.title,p.name AS projectName,p.id AS projectId
    FROM approvals a JOIN tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project_id ORDER BY CASE a.status WHEN 'PENDING' THEN 0 ELSE 1 END,a.created_at DESC`).all() as any[]).map((approval) => ({
      ...approval,
      summary: sanitizeForPolicy(db, approval.summary, { projectId: approval.projectId, taskId: approval.taskId, source: "approval-summary" }),
      payloadJson: sanitizeForPolicy(db, approval.payloadJson, { projectId: approval.projectId, taskId: approval.taskId, source: "approval-payload" }),
      projectId: undefined
    }))
}));

app.post("/api/proposals", async (request, reply) => {
  const parsed = CreateProposalSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid proposal", details: parsed.error.flatten() });
  const task = db.prepare(`SELECT t.id,t.project_id AS projectId,p.root_path AS rootPath
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(parsed.data.taskId) as any;
  if (!task) return reply.status(404).send({ error: "Task not found" });
  try {
    const currentRound = getCurrentTaskRound(db, task.id);
    assertFilePermission(db, { projectId: task.projectId, rootPath: task.rootPath, filePath: parsed.data.filePath, action: "FILE_PROPOSAL", operation: parsed.data.operation, proposedContent: parsed.data.proposedContent, taskId: task.id, now: now(), audit });
    const proposal = await insertProposal(db, {
      id: nanoid(),
      taskId: task.id,
      taskRoundId: currentRound?.id ?? null,
      projectId: task.projectId,
      rootPath: task.rootPath,
      filePath: parsed.data.filePath,
      operation: parsed.data.operation,
      proposedContent: parsed.data.proposedContent,
      reason: parsed.data.reason,
      now: now()
    });
    audit("CHANGE_PROPOSAL_CREATED", `Proposal ${proposal.operation} ${proposal.filePath}`, { projectId: task.projectId, taskId: task.id, payload: { proposalId: proposal.id } });
    return reply.status(201).send({ proposal });
  } catch (error) {
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to create proposal" });
  }
});

app.get("/api/tasks/:taskId/proposals", async (request: any) => ({
  proposals: db.prepare(`SELECT cp.id,cp.task_id AS taskId,cp.task_round_id AS taskRoundId,cp.agent_id AS agentId,cp.task_assignment_id AS taskAssignmentId,cp.file_path AS filePath,cp.operation,cp.original_content_hash AS originalContentHash,cp.reason,cp.status,cp.created_at AS createdAt,cp.updated_at AS updatedAt,a.name AS ownerName,a.role AS ownerRole,ta.conflict_state AS conflictState
    FROM change_proposals cp
    LEFT JOIN agents a ON a.id=cp.agent_id
    LEFT JOIN task_assignments ta ON ta.id=cp.task_assignment_id
    WHERE cp.task_id=? ORDER BY cp.created_at`).all(request.params.taskId)
}));

app.get("/api/proposals/:proposalId/diff", async (request: any, reply) => {
  const proposal = db.prepare("SELECT id,file_path AS filePath,operation,unified_diff AS unifiedDiff,reason,status FROM change_proposals WHERE id=?").get(request.params.proposalId) as any;
  if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
  return { proposal };
});

app.post("/api/tasks/:taskId/apply", async (request: any, reply) => {
  try {
    return await applyTaskProposals(db, request.params.taskId, now(), audit);
  } catch (error) {
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to apply task proposals" });
  }
});

app.get("/api/tasks/:taskId/execution", async (request: any, reply) => {
  const task = db.prepare("SELECT id FROM tasks WHERE id=?").get(request.params.taskId);
  if (!task) return reply.status(404).send({ error: "Task not found" });
  return getTaskExecution(db, request.params.taskId);
});

app.get("/api/tasks/:taskId/history", async (request: any, reply) => {
  try {
    return listTaskHistory(db, request.params.taskId);
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: "Unable to load task history" });
  }
});

app.post("/api/tasks/:taskId/run-checks", async (request: any, reply) => {
  try {
    return await runTaskChecks(db, request.params.taskId, now(), request.body?.action);
  } catch (error) {
    return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to run checks" });
  }
});

app.post("/api/tasks/:taskId/rollback", async (request: any, reply) => {
  try {
    return await rollbackTask(db, request.params.taskId, now(), audit);
  } catch (error) {
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to roll back task" });
  }
});

app.post("/api/tasks/:taskId/recover", async (request: any, reply) => {
  try {
    return await recoverTaskExecution(db, request.params.taskId, now(), audit);
  } catch (error) {
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to recover task execution" });
  }
});

app.post("/api/proposals/:proposalId/approve", async (request: any, reply) => {
  const parsed = ProposalActionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid proposal action" });
  const proposal = db.prepare("SELECT id,task_id AS taskId,project_id AS projectId,file_path AS filePath,status FROM change_proposals WHERE id=?").get(request.params.proposalId) as any;
  if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
  if (proposal.status !== "PENDING") return reply.status(409).send({ error: "Proposal is already decided" });
  db.prepare("UPDATE change_proposals SET status='APPROVED',updated_at=? WHERE id=?").run(now(), proposal.id);
  audit("CHANGE_PROPOSAL_APPROVED", `Proposal approved for ${proposal.filePath}`, { projectId: proposal.projectId, taskId: proposal.taskId, payload: parsed.data });
  return { status: "APPROVED" };
});

app.post("/api/proposals/:proposalId/reject", async (request: any, reply) => {
  const parsed = ProposalActionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid proposal action" });
  const proposal = db.prepare("SELECT id,task_id AS taskId,project_id AS projectId,file_path AS filePath,status FROM change_proposals WHERE id=?").get(request.params.proposalId) as any;
  if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
  if (proposal.status !== "PENDING") return reply.status(409).send({ error: "Proposal is already decided" });
  db.prepare("UPDATE change_proposals SET status='REJECTED',updated_at=? WHERE id=?").run(now(), proposal.id);
  audit("CHANGE_PROPOSAL_REJECTED", `Proposal rejected for ${proposal.filePath}`, { projectId: proposal.projectId, taskId: proposal.taskId, payload: parsed.data });
  return { status: "REJECTED" };
});

app.post("/api/task-assignments/:assignmentId/:action", async (request: any, reply) => {
  const action = request.params.action as SpecialistAssignmentAction;
  if (!["pause", "resume", "retry", "cancel"].includes(action)) return reply.status(400).send({ error: "Invalid assignment action" });
  const assignment = db.prepare("SELECT ta.id,ta.task_id AS taskId,ta.task_round_id AS taskRoundId,ta.role,ta.risk_level AS riskLevel,t.project_id AS projectId FROM task_assignments ta JOIN tasks t ON t.id=ta.task_id WHERE ta.id=?").get(request.params.assignmentId) as { id: string; taskId: string; taskRoundId: string | null; role: string; riskLevel: string; projectId: string } | undefined;
  if (!assignment) return reply.status(404).send({ error: "Specialist assignment not found" });
  const timestamp = now();
  try {
    assertProjectActiveForPolicy(db, assignment.projectId, { action: "SPECIALIST_ACTION", taskId: assignment.taskId, now: timestamp, audit });
  } catch (error) {
    return reply.status(403).send({ error: error instanceof Error ? error.message : "Specialist action blocked" });
  }
  if (action === "retry" && (assignment.riskLevel === "high" || assignment.riskLevel === "critical")) {
    const approvalId = createSpecialistApproval({
      taskId: assignment.taskId,
      taskRoundId: assignment.taskRoundId,
      actionType: "SPECIALIST_RETRY",
      summary: `Approve retry for ${assignment.role} specialist assignment`,
      payload: { assignmentAction: { type: "retry", assignmentId: assignment.id } },
      riskLevel: assignment.riskLevel,
      timestamp
    });
    audit("SPECIALIST_RETRY_APPROVAL_REQUIRED", `Retry requires approval for ${assignment.role}`, { taskId: assignment.taskId, payload: { assignmentId: assignment.id, approvalId } });
    return reply.status(202).send({ approvalRequired: true, approvalId });
  }
  try {
    const updated = updateAssignmentLifecycle(db, assignment.id, action, timestamp);
    audit("SPECIALIST_ASSIGNMENT_LIFECYCLE", `${assignment.role} assignment ${action}`, { taskId: assignment.taskId, payload: { assignmentId: assignment.id, action } });
    return { assignment: updated };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to update specialist assignment" });
  }
});

app.post("/api/task-assignments/:assignmentId/reassign", async (request: any, reply) => {
  const specialistAgentId = typeof request.body?.specialistAgentId === "string" ? request.body.specialistAgentId : "";
  if (!specialistAgentId) return reply.status(400).send({ error: "Replacement specialist agent is required" });
  const assignment = db.prepare("SELECT ta.id,ta.task_id AS taskId,ta.task_round_id AS taskRoundId,ta.role,ta.risk_level AS riskLevel,t.project_id AS projectId FROM task_assignments ta JOIN tasks t ON t.id=ta.task_id WHERE ta.id=?").get(request.params.assignmentId) as { id: string; taskId: string; taskRoundId: string | null; role: string; riskLevel: string; projectId: string } | undefined;
  if (!assignment) return reply.status(404).send({ error: "Specialist assignment not found" });
  const timestamp = now();
  try {
    assertProjectActiveForPolicy(db, assignment.projectId, { action: "SPECIALIST_ACTION", taskId: assignment.taskId, now: timestamp, audit });
  } catch (error) {
    return reply.status(403).send({ error: error instanceof Error ? error.message : "Specialist reassignment blocked" });
  }
  if (assignment.riskLevel === "high" || assignment.riskLevel === "critical") {
    const approvalId = createSpecialistApproval({
      taskId: assignment.taskId,
      taskRoundId: assignment.taskRoundId,
      actionType: "SPECIALIST_REASSIGN",
      summary: `Approve reassignment for ${assignment.role} specialist assignment`,
      payload: { assignmentAction: { type: "reassign", assignmentId: assignment.id, specialistAgentId } },
      riskLevel: assignment.riskLevel,
      timestamp
    });
    audit("SPECIALIST_REASSIGN_APPROVAL_REQUIRED", `Reassignment requires approval for ${assignment.role}`, { taskId: assignment.taskId, payload: { assignmentId: assignment.id, approvalId, specialistAgentId } });
    return reply.status(202).send({ approvalRequired: true, approvalId });
  }
  try {
    const updated = reassignTaskAssignment(db, assignment.id, specialistAgentId, timestamp);
    audit("SPECIALIST_ASSIGNMENT_REASSIGNED", `${assignment.role} assignment reassigned`, { taskId: assignment.taskId, payload: { assignmentId: assignment.id, specialistAgentId } });
    return { assignment: updated };
  } catch (error) {
    if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to reassign specialist assignment" });
  }
});

app.post("/api/tasks/:taskId/proposals/apply", async (request: any, reply) => {
  try {
    return await applyTaskProposals(db, request.params.taskId, now(), audit);
  } catch (error) {
    return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to apply proposals" });
  }
});

app.post("/api/approvals/:approvalId/decision", async (request: any, reply) => {
  const parsed = ApprovalActionSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid decision" });
  const approval = db.prepare("SELECT id,task_id AS taskId,task_round_id AS taskRoundId,action_type AS actionType,payload_json AS payloadJson,status FROM approvals WHERE id=?").get(request.params.approvalId) as any;
  if (!approval) return reply.status(404).send({ error: "Approval not found" });
  if (approval.status !== "PENDING") return reply.status(409).send({ error: "Approval is already decided" });
  if (approval.actionType === "BUILD_MISSION" && parsed.data.decidedBy === "agent") return reply.status(403).send({ error: "Agents cannot approve build missions" });
  const decidedAt = now();
  db.prepare("UPDATE approvals SET status=?,decision_note=?,decided_at=? WHERE id=?").run(parsed.data.decision, parsed.data.note ?? null, decidedAt, approval.id);
  const policyApproval = resolveProjectPolicyApproval(db, approval.id, parsed.data.decision, decidedAt, audit);
  const buildMissionApproval = resolveBuildMissionApproval(db, approval.id, parsed.data.decision, decidedAt, audit, parsed.data.decidedBy);
  const payload = parsePayload(approval.payloadJson);
  const assignmentAction = payload.assignmentAction as { type?: string; assignmentId?: string; specialistAgentId?: string } | undefined;
  if (assignmentAction?.assignmentId && parsed.data.decision === "APPROVED") {
    try {
      if (assignmentAction.type === "retry") {
        updateAssignmentLifecycle(db, assignmentAction.assignmentId, "retry", decidedAt);
        audit("SPECIALIST_ASSIGNMENT_RETRY_APPROVED", "Specialist assignment retry approved", { taskId: approval.taskId, payload: { assignmentId: assignmentAction.assignmentId, approvalId: approval.id } });
      } else if (assignmentAction.type === "reassign" && assignmentAction.specialistAgentId) {
        reassignTaskAssignment(db, assignmentAction.assignmentId, assignmentAction.specialistAgentId, decidedAt);
        audit("SPECIALIST_ASSIGNMENT_REASSIGN_APPROVED", "Specialist assignment reassignment approved", { taskId: approval.taskId, payload: { assignmentId: assignmentAction.assignmentId, specialistAgentId: assignmentAction.specialistAgentId, approvalId: approval.id } });
      }
    } catch (error) {
      if (error instanceof MediaStudioError) return reply.status(error.statusCode).send({ error: error.message });
      return reply.status(409).send({ error: error instanceof Error ? error.message : "Unable to apply specialist approval" });
    }
  }
  const specialistApproval = typeof approval.actionType === "string" && approval.actionType.startsWith("SPECIALIST_");
  const gitApproval = approval.actionType === "GIT_MERGE";
  if (gitApproval) {
    audit(parsed.data.decision === "APPROVED" ? "GIT_MERGE_APPROVED" : "GIT_MERGE_REJECTED", `Git merge ${parsed.data.decision.toLowerCase()}`, { taskId: approval.taskId, payload: { approvalId: approval.id } });
  }
  if (!specialistApproval && !policyApproval && !gitApproval && !buildMissionApproval) db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(parsed.data.decision === "APPROVED" ? "APPROVED" : "CANCELLED", decidedAt, approval.taskId);
  if (approval.taskRoundId && !specialistApproval && !policyApproval && !gitApproval && !buildMissionApproval) {
    updateTaskRound(db, approval.taskRoundId, {
      status: parsed.data.decision === "APPROVED" ? "APPROVED" : "CANCELLED",
      nextRequiredAction: parsed.data.decision === "APPROVED" ? "APPLY_PROPOSALS" : "CONTINUE_CHAT",
      completedAt: decidedAt,
      recoveryAvailable: false,
      recoveryStatus: parsed.data.decision === "APPROVED" ? "APPROVED" : "CANCELLED",
      recoveryOutcome: parsed.data.decision === "APPROVED" ? "AWAITING_APPLICATION" : "TASK_CANCELLED",
      now: decidedAt
    });
  }
  audit("APPROVAL_DECIDED", `Approval ${parsed.data.decision.toLowerCase()}`, { taskId: approval.taskId, payload: parsed.data });
  return { status: parsed.data.decision };
});

app.post("/api/agents", async (request, reply) => {
  const parsed = CreateAgentSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid agent", details: parsed.error.flatten() });
  const id = nanoid(); const timestamp = now();
  const instructions = `Purpose: ${parsed.data.purpose}
Rules: Work only within assigned projects. Request approval before writes, installs, external submissions, deployments, secret access, or destructive actions.`;
  db.prepare("INSERT INTO agents (id,name,role,purpose,instructions,status,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, parsed.data.name, "SPECIALIST", parsed.data.purpose, instructions, "DRAFT", parsed.data.projectId ?? null, timestamp, timestamp);
  audit("AGENT_CREATED", `${parsed.data.name} created as draft`, { agentId: id, projectId: parsed.data.projectId, payload: { purpose: parsed.data.purpose } });
  return reply.status(201).send({ id, name: parsed.data.name, purpose: parsed.data.purpose, status: "DRAFT", instructions });
});

app.get("/api/audit", async () => ({
  events: db.prepare("SELECT id,event_type AS eventType,summary,project_id AS projectId,task_id AS taskId,created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT 200").all()
}));

const port = Number(process.env.S4_API_PORT ?? 4310);
generationWorker.recoverStartup(now());
if (process.env.NODE_ENV !== "test") {
  await app.listen({ host: "127.0.0.1", port });
}

export { app };
