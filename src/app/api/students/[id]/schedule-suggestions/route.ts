import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { getLlmClient } from '@/server/llm/client';
import { requestScheduleSuggestion } from '@/server/llm/scheduling';

const Schema = z.object({ request: z.string().min(1).max(500), subject: z.string().max(20).optional() });

/** AI 排班助手：只返回建议，不写入报名 */
export const POST = route(
  async ({ db, actor, params, req }) => {
    const input = await body(req, Schema);
    return requestScheduleSuggestion(db, actor, { studentId: intParam(params.id), ...input }, getLlmClient());
  },
  { roles: ['admin'] },
);
