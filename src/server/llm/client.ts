// LLM 接入层：按环境变量选择协议，返回统一的 LlmClient。
// 没有配置可用的模型时返回 null，调用方走降级路径，系统其余功能照常工作。
import { createAnthropicClient } from './anthropic';
import { createOpenAIClient } from './openai';
import type { LlmClient, LlmProvider } from './types';

export type { LlmClient } from './types';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseURL?: string;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  strictTools?: boolean;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

/**
 * 环境变量：
 * - LLM_PROVIDER    anthropic（默认）| openai（OpenAI 及兼容协议：DeepSeek、通义千问、Ollama、vLLM…）
 * - LLM_MODEL       模型名；openai 协议必填
 * - LLM_API_KEY     通用 key；未设置时分别回退到 ANTHROPIC_API_KEY / OPENAI_API_KEY
 * - LLM_BASE_URL    自定义地址（Anthropic 兼容网关，或 OpenAI 兼容服务如 http://localhost:11434/v1）
 * - LLM_MAX_TOKENS_FIELD  openai 协议下用 max_completion_tokens 还是 max_tokens（默认 max_tokens）
 * - LLM_STRICT_TOOLS      设为 false 时不发送 strict 字段（部分兼容服务不认识）
 */
export function resolveLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const raw = (env.LLM_PROVIDER || 'anthropic').trim().toLowerCase();
  if (raw !== 'anthropic' && raw !== 'openai') {
    console.warn(`[llm] 不支持的 LLM_PROVIDER=${raw}，AI 功能将降级`);
    return null;
  }
  const provider: LlmProvider = raw;
  const baseURL = env.LLM_BASE_URL || undefined;
  if (provider === 'anthropic') {
    const apiKey = env.LLM_API_KEY || env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { provider, model: env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL, apiKey, baseURL };
  }
  const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || undefined;
  // 本地模型（如 Ollama）不需要 key，但必须给出地址
  if (!apiKey && !baseURL) return null;
  if (!env.LLM_MODEL) {
    console.warn('[llm] LLM_PROVIDER=openai 时必须设置 LLM_MODEL，AI 功能将降级');
    return null;
  }
  return {
    provider,
    model: env.LLM_MODEL,
    apiKey,
    baseURL,
    maxTokensField: env.LLM_MAX_TOKENS_FIELD === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    strictTools: env.LLM_STRICT_TOOLS !== 'false',
  };
}

export function createLlmClient(cfg: LlmConfig): LlmClient {
  return cfg.provider === 'anthropic'
    ? createAnthropicClient({ apiKey: cfg.apiKey!, model: cfg.model, baseURL: cfg.baseURL })
    : createOpenAIClient({ apiKey: cfg.apiKey, model: cfg.model, baseURL: cfg.baseURL, maxTokensField: cfg.maxTokensField, strictTools: cfg.strictTools });
}

const g = globalThis as unknown as { __llmOverride?: LlmClient | null };

export function getLlmClient(): LlmClient | null {
  if (g.__llmOverride !== undefined) return g.__llmOverride;
  const cfg = resolveLlmConfig();
  return cfg ? createLlmClient(cfg) : null;
}

/** 测试用：注入假实现；传 undefined 恢复默认 */
export function setLlmClientForTests(client: LlmClient | null | undefined) {
  g.__llmOverride = client;
}
