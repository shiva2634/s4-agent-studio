import {
  CODE_PROPOSAL_SYSTEM_PROMPT,
  type AiProvider,
  type CodeProposalInput,
  type CodeProposalOutput,
  type ProviderConfig,
  type ProviderHealthResult,
  sanitizeProviderError
} from "./ai-provider.js";

type FetchLike = typeof fetch;

export class OpenAiCompatibleProvider implements AiProvider {
  id;
  constructor(private readonly config: ProviderConfig, private readonly fetchImpl: FetchLike = fetch) {
    this.id = config.provider;
  }

  async generateCodeProposal(input: CodeProposalInput): Promise<CodeProposalOutput> {
    const response = await this.chat([
      { role: "system", content: CODE_PROPOSAL_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(input) }
    ], 0.2);
    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Provider returned an empty response");
    return JSON.parse(content) as CodeProposalOutput;
  }

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

  private async chat(messages: Array<{ role: string; content: string }>, temperature: number, maxTokens?: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      let lastError: unknown;
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
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
          if (!response.ok) throw new Error(`Provider request failed with status ${response.status}`);
          return await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        } catch (error) {
          lastError = error;
          if (attempt >= this.config.maxRetries) throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

