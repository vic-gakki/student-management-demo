// OpenAI Chat Completions 协议适配器（/v1/chat/completions）。
// 适用于 OpenAI，以及兼容这个协议的服务（DeepSeek、通义千问、Ollama、vLLM 等）。
// 直接用 fetch 调用，不额外引入 SDK 依赖，兼容服务只需要改 baseURL。
import type { ChatRequest, ChatResponse, ContentBlock, LlmClient, StopReason } from './types';

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  /** OpenAI 新模型要求 max_completion_tokens；多数兼容服务只认 max_tokens */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** 部分兼容服务不认识 strict 字段，可以关掉 */
  strictTools?: boolean;
  fetch?: typeof fetch;
}

export function toOpenAIBody(req: ChatRequest, opts: OpenAIOptions) {
  const messages: OpenAIMessage[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content } as OpenAIMessage);
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      const calls = m.content
        .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
        .map((b) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Anthropic 把工具结果放在 user 消息里；OpenAI 要求每个结果是单独的 tool 消息
      for (const b of m.content) if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.toolCallId, content: b.isError ? `ERROR: ${b.content}` : b.content });
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      if (text) messages.push({ role: 'user', content: text });
    }
  }
  const strict = opts.strictTools ?? true;
  return {
    model: opts.model,
    messages,
    [opts.maxTokensField ?? 'max_tokens']: req.maxTokens,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema, ...(t.strict && strict ? { strict: true } : {}) },
          })),
          tool_choice: 'auto',
        }
      : {}),
  };
}

const STOP: Record<string, StopReason> = { stop: 'end', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

interface OpenAIResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAIToolCall[]; refusal?: string | null }; finish_reason?: string }[];
}

export function fromOpenAIResponse(data: OpenAIResponse): ChatResponse {
  const choice = data.choices?.[0];
  if (!choice?.message) throw new Error('OpenAI 协议响应里没有 choices[0].message');
  const content: ContentBlock[] = [];
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
  for (const c of choice.message.tool_calls ?? []) {
    let input: unknown;
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      // 参数不是合法 JSON：原样交给上层，Zod 校验会拒绝并走降级
      input = { __invalidJson: c.function.arguments };
    }
    content.push({ type: 'tool_call', id: c.id, name: c.function.name, input });
  }
  const stopReason = choice.message.refusal ? 'refusal' : (STOP[choice.finish_reason ?? ''] ?? (content.some((b) => b.type === 'tool_call') ? 'tool_use' : 'other'));
  return { content, stopReason };
}

export function createOpenAIClient(opts: OpenAIOptions): LlmClient {
  const base = (opts.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  return {
    provider: 'openai',
    model: opts.model,
    async chat(req, { timeoutMs }) {
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify(toOpenAIBody(req, opts)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        let message = text.slice(0, 300);
        try {
          message = JSON.parse(text)?.error?.message ?? message;
        } catch {
          /* 非 JSON 错误体，保留原文 */
        }
        throw new Error(`OpenAI 协议请求失败（${res.status}）：${message}`);
      }
      return fromOpenAIResponse(JSON.parse(text));
    },
  };
}
