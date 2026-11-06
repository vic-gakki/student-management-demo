// Anthropic Messages API 适配器（官方 SDK）。
import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResponse, ContentBlock, LlmClient, StopReason } from './types';

export function toAnthropicParams(req: ChatRequest, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(toAnthropicBlock),
    })),
    ...(req.tools?.length
      ? {
          tools: req.tools.map(
            (t) =>
              ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
                ...(t.strict ? { strict: true } : {}),
              }) as Anthropic.Tool,
          ),
          tool_choice: { type: 'auto' as const },
        }
      : {}),
  };
}

function toAnthropicBlock(b: ContentBlock): Anthropic.ContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_call':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolCallId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
  }
}

const STOP: Record<string, StopReason> = { end_turn: 'end', stop_sequence: 'end', tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal' };

export function fromAnthropicMessage(msg: Anthropic.Message): ChatResponse {
  const content: ContentBlock[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') content.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') content.push({ type: 'tool_call', id: b.id, name: b.name, input: b.input });
    // 其他块（如 thinking）对业务没有意义，忽略
  }
  return { content, stopReason: STOP[msg.stop_reason ?? ''] ?? 'other' };
}

export function createAnthropicClient(opts: { apiKey: string; model: string; baseURL?: string }): LlmClient {
  // 超时由调用方按剩余预算控制，不让 SDK 自动重试（重试会突破总时长）
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0 });
  return {
    provider: 'anthropic',
    model: opts.model,
    async chat(req, { timeoutMs }) {
      const msg = await client.messages.create(toAnthropicParams(req, opts.model), { timeout: timeoutMs });
      return fromAnthropicMessage(msg);
    },
  };
}
