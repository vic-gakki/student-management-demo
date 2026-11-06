// LLM 接入层：业务代码只依赖 LlmClient 接口，测试时可以换成脚本化的假实现。
// 没有配置 ANTHROPIC_API_KEY 时返回 null，调用方走降级路径，系统其余功能照常工作。
import Anthropic from '@anthropic-ai/sdk';

export type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>;

export interface LlmClient {
  model: string;
  create(params: CreateParams, opts: { timeoutMs: number }): Promise<Anthropic.Message>;
}

export function createAnthropicClient(apiKey: string, model: string): LlmClient {
  // 超时由调用方按剩余预算控制，这里不再让 SDK 自动重试（重试会突破总时长）
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    model,
    create: (params, opts) => client.messages.create({ ...params, model }, { timeout: opts.timeoutMs }),
  };
}

const g = globalThis as unknown as { __llmOverride?: LlmClient | null };

export function getLlmClient(): LlmClient | null {
  if (g.__llmOverride !== undefined) return g.__llmOverride;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropicClient(key, process.env.LLM_MODEL || 'claude-haiku-5-5');
}

/** 测试用：注入假实现；传 undefined 恢复默认 */
export function setLlmClientForTests(client: LlmClient | null | undefined) {
  g.__llmOverride = client;
}

/** 取出回复里的第一个指定工具调用 */
export function findToolUse(msg: Anthropic.Message, name: string): Anthropic.ToolUseBlock | undefined {
  return msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name);
}
