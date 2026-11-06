import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { markAttendance } from '@/server/services/attendance';
import { processSessionFeedback } from '@/server/llm/feedback';
import { getLlmClient } from '@/server/llm/client';

const Schema = z.object({
  entries: z
    .array(
      z.object({
        studentId: z.number().int().positive(),
        status: z.enum(['present', 'late', 'excused', 'absent']),
        feedback: z.string().max(1000).nullable().optional(),
        needsFollowUp: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * 点名：先在事务里提交出勤和扣课时；提交成功后再整理反馈。
 * AI 失败不会影响已经提交的点名，只会把反馈标记为"整理失败，已保存原文"。
 */
export const POST = route(
  async ({ db, actor, params, req }) => {
    const sessionId = intParam(params.id);
    const result = await markAttendance(db, actor, sessionId, (await body(req, Schema)).entries);
    const feedback = await processSessionFeedback(db, sessionId, getLlmClient()).catch((err: unknown) => ({
      status: 'failed' as const,
      processed: 0,
      error: err instanceof Error ? err.message : String(err),
    }));
    return { ...result, feedback };
  },
  { roles: ['teacher'] },
);
