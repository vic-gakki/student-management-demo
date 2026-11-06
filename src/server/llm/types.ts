// 与协议无关的 LLM 消息格式。
// 业务代码（排班助手、反馈整理）只认这里的类型；Anthropic / OpenAI 的格式差异全部在适配器里转换。

export type LlmProvider = 'anthropic' | 'openai';

/** 工具定义：inputSchema 是标准 JSON Schema，两家协议都能用 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 要求模型严格按 schema 生成参数（两家都支持，但兼容服务不一定） */
  strict?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens: number;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResponse {
  /** 只会包含 text 和 tool_call 块 */
  content: ContentBlock[];
  stopReason: StopReason;
}

export interface LlmClient {
  provider: LlmProvider;
  model: string;
  chat(req: ChatRequest, opts: { timeoutMs: number }): Promise<ChatResponse>;
}

export function toolCalls(res: ChatResponse) {
  return res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call');
}

export function findToolCall(res: ChatResponse, name: string) {
  return toolCalls(res).find((b) => b.name === name);
}
