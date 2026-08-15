import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

/** LLM 调用超时：60 秒 */
const REQUEST_TIMEOUT_MS = 60_000;

export type AiChatRole = "system" | "user" | "assistant";
export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

/**
 * OpenAI 兼容大模型调用（DeepSeek / OpenAI / 通义等）。
 *
 * 配置：
 * - AI_API_KEY：必填，未配置时所有调用返回 503（fail-closed）
 * - AI_BASE_URL：OpenAI 兼容 baseUrl，默认 https://api.openai.com/v1
 * - AI_MODEL：模型名，平台要求 DeepSeek 只用 flash 版（deepseek-v4-flash）
 * - AI_REASONING_EFFORT：思考强度，最低为 none（默认），high 为完整思考
 */
@Injectable()
export class AiLlmService {
  private readonly logger = new Logger(AiLlmService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly reasoningEffort: string;
  private readonly enabled: boolean;

  constructor() {
    this.apiKey = (process.env.AI_API_KEY ?? "").trim();
    this.baseUrl = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/, "");
    this.model = (process.env.AI_MODEL ?? "gpt-4o-mini").trim();
    this.reasoningEffort = (process.env.AI_REASONING_EFFORT ?? "none").trim();
    this.enabled = this.apiKey.length > 0;
    if (!this.enabled) {
      this.logger.warn("AI_API_KEY 未配置：AI 功能停用（返回 503）");
    }
  }

  /** 调用 chat/completions，返回模型回复文本 */
  async complete(messages: AiChatMessage[], maxTokens = 1400): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException("AI 服务未配置，请联系管理员（AI_API_KEY）");
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
          // 思考强度拉到最低（DeepSeek v4：none=最低，high=默认）
          ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`ai request threw: ${String(error)}`);
      throw new ServiceUnavailableException("AI 服务暂不可用，请稍后重试");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`ai api ${response.status}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        response.status === 401
          ? "AI 服务鉴权失败，请检查 AI_API_KEY"
          : `AI 服务调用失败（HTTP ${response.status}）`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceUnavailableException("AI 服务返回为空，请重试");
    }
    return content;
  }

  get modelName(): string {
    return this.model;
  }
}
