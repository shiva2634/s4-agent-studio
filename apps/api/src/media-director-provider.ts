import { z } from "zod";
import { type ProviderConfig, type ProviderHealthResult, sanitizeProviderError } from "./ai-provider.js";

export type VideoDirectorScene = {
  title: string;
  description: string;
  durationSeconds: number;
  dialogue: string;
  visualPrompt: string;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  assetLabel: string;
};

export type VideoDirectorPlan = {
  brief: {
    title: string;
    logline: string;
    audience: string;
    style: string;
    durationSeconds: number;
    constraints: string[];
  };
  script: string;
  scenes: VideoDirectorScene[];
};

export type VideoDirectorUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type VideoDirectorProviderResult<T> = {
  provider: string;
  model: string;
  usage: VideoDirectorUsage | null;
  value: T;
};

type FetchLike = typeof fetch;

const aspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

const SceneSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  dialogue: z.string().max(10_000),
  visualPrompt: z.string().trim().min(1).max(20_000),
  aspectRatio: z.enum(aspectRatios),
  assetLabel: z.string().trim().min(1).max(200)
}).strict();

const PlanSchema = z.object({
  brief: z.object({
    title: z.string().trim().min(1).max(200),
    logline: z.string().trim().min(1).max(2_000),
    audience: z.string().trim().min(1).max(200),
    style: z.string().trim().min(1).max(200),
    durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
    constraints: z.array(z.string().trim().min(1).max(500)).max(50)
  }).strict(),
  script: z.string().trim().min(1).max(50_000),
  scenes: z.array(SceneSchema).min(1).max(40)
}).strict();

export const VIDEO_DIRECTOR_SYSTEM_PROMPT_VERSION = "video-director.v1";

const systemPrompt = `You are the S4 Media Studio Video Director (${VIDEO_DIRECTOR_SYSTEM_PROMPT_VERSION}).
Return JSON only.
Create production-ready video briefs and scenes for local-first media generation.
Never request or expose secrets.
Do not mention provider APIs, keys, or implementation details.
Every scene must include dialogue, a detailed visualPrompt, durationSeconds, aspectRatio, and assetLabel.
Prompts must be provider-ready for text-to-video or image-to-video generation.`;

export class NvidiaVideoDirectorProvider {
  readonly id = "nvidia-video-director";

  constructor(private readonly config: ProviderConfig, private readonly fetchImpl: FetchLike = fetch) {}

  async testConnection(): Promise<ProviderHealthResult> {
    const testedAt = new Date().toISOString();
    if (!this.config.configured) return { status: "disabled", lastTestedAt: testedAt };
    try {
      await this.chat([{ role: "user", content: "Return JSON only: {\"ok\":true}" }], 0, 16);
      return { status: "ok", lastTestedAt: testedAt };
    } catch (error) {
      return { status: "error", lastTestedAt: testedAt, sanitizedError: sanitizeProviderError(error) };
    }
  }

  async generatePlan(input: { projectName: string; projectDescription: string | null; userIdea: string; existingContext: unknown }): Promise<VideoDirectorProviderResult<VideoDirectorPlan>> {
    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ mode: "FULL_PLAN", ...input }) }
    ], 0.4);
    return {
      provider: this.config.provider,
      model: this.config.model,
      usage: normalizeUsage(response.usage),
      value: validateVideoDirectorPlan(parseJsonContent(response))
    };
  }

  async generateScene(input: { projectName: string; projectDescription: string | null; userIdea: string; existingBrief: unknown; existingScene: unknown }): Promise<VideoDirectorProviderResult<VideoDirectorScene>> {
    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ mode: "SCENE_REGENERATION", ...input }) }
    ], 0.4);
    return {
      provider: this.config.provider,
      model: this.config.model,
      usage: normalizeUsage(response.usage),
      value: validateVideoDirectorScene(parseJsonContent(response))
    };
  }

  private async chat(messages: Array<{ role: string; content: string }>, temperature: number, maxTokens?: number): Promise<ChatResponse> {
    if (!this.config.configured) throw new Error("NVIDIA provider is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          response_format: { type: "json_object" }
        })
      });
      if (!response.ok) throw new Error(`NVIDIA video director request failed with status ${response.status}`);
      return await response.json() as ChatResponse;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw new Error("NVIDIA video director request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validateVideoDirectorPlan(raw: unknown): VideoDirectorPlan {
  return PlanSchema.parse(raw);
}

export function validateVideoDirectorScene(raw: unknown): VideoDirectorScene {
  return SceneSchema.parse(raw);
}

function parseJsonContent(response: ChatResponse): unknown {
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("NVIDIA video director returned an empty response");
  return JSON.parse(content) as unknown;
}

function normalizeUsage(usage: ChatResponse["usage"]): VideoDirectorUsage | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens
  };
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
