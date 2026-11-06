// 协议适配层：Anthropic / OpenAI 两种格式与中立格式之间的转换，以及按环境变量选择协议。
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { fromAnthropicMessage, toAnthropicParams } from '@/server/llm/anthropic';
import { createOpenAIClient, fromOpenAIResponse, toOpenAIBody } from '@/server/llm/openai';
import { resolveLlmConfig } from '@/server/llm/client';
import type { ChatRequest } from '@/server/llm/types';

const req: ChatRequest = {
  system: '系统提示',
  maxTokens: 1000,
  tools: [
    { name: 'lookup', description: '只读查询', inputSchema: { type: 'object', properties: {} } },
    { name: 'submit', description: '提交', strict: true, inputSchema: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'], additionalProperties: false } },
  ],
  messages: [
    { role: 'user', content: '帮我排班' },
    { role: 'assistant', content: [{ type: 'text', text: '先查一下' }, { type: 'tool_call', id: 'call_1', name: 'lookup', input: { a: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', toolCallId: 'call_1', content: '{"ok":true}' }, { type: 'tool_result', toolCallId: 'call_2', content: '失败', isError: true }] },
  ],
};

describe('Anthropic 适配器', () => {
  it('请求：工具、tool_use、tool_result 映射为 Messages API 格式', () => {
    const p = toAnthropicParams(req, 'claude-haiku-5-5');
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.system).toBe('系统提示');
    expect(p.tools).toEqual([
      { name: 'lookup', description: '只读查询', input_schema: { type: 'object', properties: {} } },
      { name: 'submit', description: '提交', input_schema: req.tools![1].inputSchema, strict: true },
    ]);
    expect(p.tool_choice).toEqual({ type: 'auto' });
    expect(p.messages[1].content).toEqual([
      { type: 'text', text: '先查一下' },
      { type: 'tool_use', id: 'call_1', name: 'lookup', input: { a: 1 } },
    ]);
    expect(p.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true}' },
      { type: 'tool_result', tool_use_id: 'call_2', content: '失败', is_error: true },
    ]);
  });

  it('响应：tool_use → tool_call，忽略 thinking，映射停止原因', () => {
    const msg = {
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: '好的' },
        { type: 'tool_use', id: 'tu_1', name: 'submit', input: { x: 1 } },
      ],
      stop_reason: 'tool_use',
    } as unknown as Anthropic.Message;
    expect(fromAnthropicMessage(msg)).toEqual({
      content: [
        { type: 'text', text: '好的' },
        { type: 'tool_call', id: 'tu_1', name: 'submit', input: { x: 1 } },
      ],
      stopReason: 'tool_use',
    });
    expect(fromAnthropicMessage({ content: [], stop_reason: 'refusal' } as unknown as Anthropic.Message).stopReason).toBe('refusal');
  });
});

describe('OpenAI 协议适配器', () => {
  it('请求：system 放第一条、工具调用参数转成 JSON 字符串、每个工具结果单独一条 tool 消息', () => {
    const body = toOpenAIBody(req, { model: 'gpt-x' }) as Record<string, unknown> & { messages: unknown[]; tools: unknown[] };
    expect(body.max_tokens).toBe(1000);
    expect(body.tool_choice).toBe('auto');
    expect(body.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '帮我排班' },
      { role: 'assistant', content: '先查一下', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 'call_2', content: 'ERROR: 失败' },
    ]);
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'lookup', description: '只读查询', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'submit', description: '提交', parameters: req.tools![1].inputSchema, strict: true } },
    ]);
  });

  it('可选：max_completion_tokens 字段、关闭 strict', () => {
    const body = toOpenAIBody(req, { model: 'm', maxTokensField: 'max_completion_tokens', strictTools: false }) as Record<string, unknown> & {
      tools: { function: Record<string, unknown> }[];
    };
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.tools[1].function.strict).toBeUndefined();
  });

  it('响应：解析 tool_calls；参数不是合法 JSON 时交给上层校验；缺 choices 时报错', () => {
    const res = fromOpenAIResponse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'submit', arguments: '{"x":2}' } },
              { id: 'c2', type: 'function', function: { name: 'submit', arguments: '{oops' } },
            ],
          },
        },
      ],
    });
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([
      { type: 'tool_call', id: 'c1', name: 'submit', input: { x: 2 } },
      { type: 'tool_call', id: 'c2', name: 'submit', input: { __invalidJson: '{oops' } },
    ]);
    expect(fromOpenAIResponse({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] })).toEqual({
      content: [{ type: 'text', text: '你好' }],
      stopReason: 'end',
    });
    expect(() => fromOpenAIResponse({})).toThrow();
  });

  it('客户端：请求地址与鉴权头；非 2xx 抛出带服务端信息的错误', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = createOpenAIClient({
      apiKey: 'test-key',
      model: 'm',
      baseURL: 'http://llm.local/v1/',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }), { status: 200 });
      },
    });
    await ok.chat(req, { timeoutMs: 1000 });
    expect(seen[0].url).toBe('http://llm.local/v1/chat/completions');
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key');

    const bad = createOpenAIClient({
      model: 'm',
      baseURL: 'http://llm.local/v1',
      fetch: async () => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }),
    });
    await expect(bad.chat(req, { timeoutMs: 1000 })).rejects.toThrow(/404.*model not found/);
  });
});

describe('按环境变量选择协议', () => {
  it('默认 Anthropic；只有 ANTHROPIC_API_KEY 时保持兼容', () => {
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'k' })).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'k' });
    expect(resolveLlmConfig({})).toBeNull();
  });

  it('OpenAI 协议：需要模型名；本地服务可以不带 key 但要有地址', () => {
    expect(resolveLlmConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toBeNull();
    expect(resolveLlmConfig({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k', LLM_MODEL: 'deepseek-chat', LLM_BASE_URL: 'https://api.deepseek.com/v1' })).toMatchObject({
      provider: 'openai',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokensField: 'max_tokens',
      strictTools: true,
    });
    expect(resolveLlmConfig({ LLM_PROVIDER: 'openai', LLM_MODEL: 'qwen2.5', LLM_BASE_URL: 'http://localhost:11434/v1', LLM_STRICT_TOOLS: 'false' })).toMatchObject({
      apiKey: undefined,
      strictTools: false,
    });
    expect(resolveLlmConfig({ LLM_PROVIDER: 'openai', LLM_MODEL: 'x' })).toBeNull();
    expect(resolveLlmConfig({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' })).toBeNull();
  });
});
