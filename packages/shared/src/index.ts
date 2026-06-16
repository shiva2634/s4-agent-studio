import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "DRAFT", "PLANNING", "AWAITING_APPROVAL", "APPROVED", "RUNNING",
  "PAUSED", "TESTING", "FAILED", "FAILED_VALIDATION", "COMPLETED", "CANCELLED", "ROLLED_BACK"
]);
export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  rootPath: z.string().trim().min(1).max(500)
});

export const ChatRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().optional(),
  message: z.string().trim().min(1).max(20_000)
});

export const ApprovalActionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(2_000).optional()
});

export const CreateAgentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  purpose: z.string().trim().min(10).max(4_000),
  projectId: z.string().optional()
});

export const ProposalOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE"]);
export const ProposalActionSchema = z.object({
  note: z.string().max(2_000).optional()
});

export const CreateProposalSchema = z.object({
  taskId: z.string().min(1),
  filePath: z.string().trim().min(1).max(500),
  operation: ProposalOperationSchema,
  proposedContent: z.string().max(500_000).optional(),
  reason: z.string().trim().min(1).max(2_000)
});

export const CreateMediaProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2_000).optional()
});

export const UpdateMediaProjectSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(2_000).optional()
});

export const MediaChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  replaceApproved: z.boolean().optional(),
  regenerateSceneId: z.string().min(1).optional()
});

export const MediaSceneStatusSchema = z.enum(["DRAFT", "APPROVED", "GENERATING", "ASSET_READY", "REJECTED"]);
export const MediaAspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);

export const UpdateMediaBriefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  logline: z.string().trim().min(1).max(2_000),
  audience: z.string().trim().min(1).max(200),
  style: z.string().trim().min(1).max(200),
  durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  constraints: z.array(z.string().trim().min(1).max(500)).max(50)
});

export const UpdateMediaSceneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  dialogue: z.string().max(10_000),
  visualPrompt: z.string().trim().min(1).max(20_000),
  aspectRatio: MediaAspectRatioSchema,
  status: MediaSceneStatusSchema
});

export const ImportMediaAssetSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(2_000_000_000),
  label: z.string().trim().min(1).max(200).optional()
});

export const MediaAudioRoleSchema = z.enum(["NARRATION", "MUSIC", "SFX", "SCENE_AUDIO"]);

export const UpdateMediaAudioSettingsSchema = z.object({
  role: MediaAudioRoleSchema.optional(),
  volume: z.number().min(0).max(2).optional(),
  trimStartSeconds: z.number().min(0).max(24 * 60 * 60).optional(),
  trimEndSeconds: z.number().min(0).max(24 * 60 * 60).optional(),
  fadeInSeconds: z.number().min(0).max(60).optional(),
  fadeOutSeconds: z.number().min(0).max(60).optional(),
  muted: z.boolean().optional()
});

export const MediaBrandKitSchema = z.object({
  name: z.string().trim().min(1).max(160),
  colors: z.array(z.string().trim().min(1).max(80)).max(20),
  fonts: z.array(z.string().trim().min(1).max(120)).max(20),
  tagline: z.string().trim().max(500),
  tone: z.string().trim().max(2_000),
  disclaimer: z.string().trim().max(1_000)
});

export const MediaPresenterProfileSchema = z.object({
  name: z.string().trim().min(1).max(160),
  appearancePrompt: z.string().trim().max(4_000),
  voiceAccent: z.string().trim().max(500),
  clothing: z.string().trim().max(1_000),
  consistencyRules: z.string().trim().max(2_000)
});

export const SelectMediaDefaultsSchema = z.object({
  brandKitId: z.string().min(1).nullable().optional(),
  presenterProfileId: z.string().min(1).nullable().optional()
});

export const MediaTemplateTypeSchema = z.enum(["PROMO", "PRESENTER", "EXPLAINER", "INVESTOR_PITCH", "REEL", "YOUTUBE"]);
export const MediaTemplateSceneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  prompt: z.string().trim().min(1).max(20_000),
  dialogue: z.string().max(10_000).optional(),
  assetLabel: z.string().trim().min(1).max(200).optional()
});

export const MediaTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  templateType: MediaTemplateTypeSchema,
  description: z.string().trim().max(2_000),
  defaultDurationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  aspectRatio: MediaAspectRatioSchema,
  sceneStructure: z.array(MediaTemplateSceneSchema).min(1).max(50),
  promptRules: z.string().trim().max(10_000),
  captionStyle: z.record(z.string(), z.unknown()),
  audioSettings: z.record(z.string(), z.unknown()),
  brandRules: z.record(z.string(), z.unknown())
});

export const CreateProjectFromTemplateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2_000).optional()
});

export const ApplyMediaTemplateSchema = z.object({
  approved: z.boolean(),
  replaceAssets: z.boolean().optional()
});

export const ReorderMediaScenesSchema = z.object({
  sceneIds: z.array(z.string().min(1)).min(1).max(200)
});

export const RenderMediaDraftSchema = z.object({
  fps: z.number().int().min(12).max(60).optional(),
  width: z.number().int().min(320).max(7680).optional(),
  height: z.number().int().min(180).max(4320).optional(),
  includeLogo: z.boolean().optional()
});

export const MediaExportPresetSchema = z.enum(["9:16", "16:9", "1:1"]);
export const MediaExportResolutionSchema = z.enum(["720p", "1080p"]);

export const RenderMediaExportSchema = z.object({
  preset: MediaExportPresetSchema,
  resolution: MediaExportResolutionSchema,
  fps: z.number().int().min(12).max(60),
  bitrateKbps: z.number().int().min(500).max(50_000),
  includeCaptions: z.boolean(),
  includeLogo: z.boolean(),
  includeDisclaimer: z.boolean(),
  includeMusic: z.boolean()
});

export const RenameMediaAssetSchema = z.object({
  label: z.string().trim().min(1).max(200)
});

export const GenerateWanSceneSchema = z.object({
  mode: z.enum(["text-to-video", "image-to-video"]),
  approved: z.boolean(),
  fps: z.number().int().min(1).max(120).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  promptVersionId: z.string().trim().min(1).optional()
});

export const RetryWanGenerationSchema = z.object({
  approved: z.boolean()
});

export const FlowJobActionSchema = z.object({
  note: z.string().trim().max(2_000).optional()
});

export const FlowFallbackWanSchema = z.object({
  approved: z.boolean()
});

export const MediaProviderTaskSchema = z.enum(["T2V", "I2V", "PRESENTER", "AUDIO_VIDEO"]);
export const MediaProviderKeySchema = z.enum(["google-flow", "wan-2.2", "longcat-avatar", "ovi", "ltx"]);
export const MediaGenerationStatusHistorySchema = z.object({
  id: z.string(),
  generationJobId: z.string(),
  status: z.string(),
  progressPercent: z.number().int().min(0).max(100).nullable(),
  message: z.string().nullable(),
  providerStatus: z.string().nullable(),
  createdAt: z.string()
});
export const MediaAssetApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export const RejectMediaAssetSchema = z.object({
  feedback: z.string().trim().min(1).max(2_000)
});
export const ClearMediaAssetApprovalSchema = z.object({
  reason: z.string().trim().max(500).optional()
});

export const RouteMediaGenerationSchema = z.object({
  task: MediaProviderTaskSchema,
  providerKey: MediaProviderKeySchema.optional(),
  approved: z.boolean(),
  paidProviderApproved: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  promptVersionId: z.string().trim().min(1).optional()
});
export const RestoreMediaSceneVersionSchema = z.object({
  approved: z.boolean(),
  changeSummary: z.string().trim().max(500).optional()
});
export const ReuseMediaPromptVersionSchema = z.object({
  approved: z.boolean(),
  paidProviderApproved: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional()
});

export const ComfyWorkflowTypeSchema = z.enum(["WAN_T2V", "WAN_I2V"]);

export const ComfyWorkflowMappingSchema = z.object({
  prompt: z.string().trim().min(1).max(200),
  width: z.string().trim().min(1).max(200),
  height: z.string().trim().min(1).max(200),
  frames: z.string().trim().min(1).max(200),
  fps: z.string().trim().min(1).max(200),
  seed: z.string().trim().min(1).max(200),
  image: z.string().trim().min(1).max(200).optional(),
  outputNodeId: z.string().trim().min(1).max(100)
});

export const ImportComfyWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  workflowType: ComfyWorkflowTypeSchema,
  workflowJson: z.unknown(),
  mapping: ComfyWorkflowMappingSchema,
  activate: z.boolean().optional()
});

export const UpdateComfyWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  workflowJson: z.unknown(),
  mapping: ComfyWorkflowMappingSchema,
  activate: z.boolean().optional()
});

export const PreviewComfyWorkflowSchema = z.object({
  workflowId: z.string().min(1).optional(),
  workflowType: ComfyWorkflowTypeSchema.optional(),
  sceneId: z.string().min(1),
  fps: z.number().int().min(1).max(120).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ProposalOperation = z.infer<typeof ProposalOperationSchema>;
export type CreateMediaProject = z.infer<typeof CreateMediaProjectSchema>;
export type MediaChatMessage = z.infer<typeof MediaChatMessageSchema>;
export type MediaSceneStatus = z.infer<typeof MediaSceneStatusSchema>;
export type UpdateMediaBrief = z.infer<typeof UpdateMediaBriefSchema>;
export type UpdateMediaScene = z.infer<typeof UpdateMediaSceneSchema>;
export type ImportMediaAsset = z.infer<typeof ImportMediaAssetSchema>;
export type MediaAudioRole = z.infer<typeof MediaAudioRoleSchema>;
export type UpdateMediaAudioSettings = z.infer<typeof UpdateMediaAudioSettingsSchema>;
export type MediaBrandKitInput = z.infer<typeof MediaBrandKitSchema>;
export type MediaPresenterProfileInput = z.infer<typeof MediaPresenterProfileSchema>;
export type SelectMediaDefaults = z.infer<typeof SelectMediaDefaultsSchema>;
export type MediaTemplateType = z.infer<typeof MediaTemplateTypeSchema>;
export type MediaTemplateInput = z.infer<typeof MediaTemplateSchema>;
export type CreateProjectFromTemplate = z.infer<typeof CreateProjectFromTemplateSchema>;
export type ApplyMediaTemplate = z.infer<typeof ApplyMediaTemplateSchema>;
export type ReorderMediaScenes = z.infer<typeof ReorderMediaScenesSchema>;
export type RenderMediaDraft = z.infer<typeof RenderMediaDraftSchema>;
export type RenderMediaExport = z.infer<typeof RenderMediaExportSchema>;
export type RenameMediaAsset = z.infer<typeof RenameMediaAssetSchema>;
export type GenerateWanScene = z.infer<typeof GenerateWanSceneSchema>;
export type RetryWanGeneration = z.infer<typeof RetryWanGenerationSchema>;
export type FlowJobAction = z.infer<typeof FlowJobActionSchema>;
export type FlowFallbackWan = z.infer<typeof FlowFallbackWanSchema>;
export type MediaProviderTask = z.infer<typeof MediaProviderTaskSchema>;
export type RouteMediaGeneration = z.infer<typeof RouteMediaGenerationSchema>;
export type RestoreMediaSceneVersion = z.infer<typeof RestoreMediaSceneVersionSchema>;
export type ReuseMediaPromptVersion = z.infer<typeof ReuseMediaPromptVersionSchema>;
export type MediaGenerationStatusHistory = z.infer<typeof MediaGenerationStatusHistorySchema>;
export type MediaAssetApprovalStatus = z.infer<typeof MediaAssetApprovalStatusSchema>;
export type RejectMediaAsset = z.infer<typeof RejectMediaAssetSchema>;
export type ClearMediaAssetApproval = z.infer<typeof ClearMediaAssetApprovalSchema>;
export type ComfyWorkflowType = z.infer<typeof ComfyWorkflowTypeSchema>;
export type ComfyWorkflowMapping = z.infer<typeof ComfyWorkflowMappingSchema>;
export type ImportComfyWorkflow = z.infer<typeof ImportComfyWorkflowSchema>;
export type UpdateComfyWorkflow = z.infer<typeof UpdateComfyWorkflowSchema>;
export type PreviewComfyWorkflow = z.infer<typeof PreviewComfyWorkflowSchema>;
