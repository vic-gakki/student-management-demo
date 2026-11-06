import { z } from 'zod';
import { body, route } from '@/server/http';
import { enrollStudent } from '@/server/services/enrollment';

const Schema = z.object({
  studentId: z.number().int().positive(),
  classId: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  transferFromClassId: z.number().int().positive().optional(),
  suggestionId: z.number().int().positive().optional(),
});

/** 排班（手动或确认 AI 建议都走这里，规则全部在服务端再检查一次） */
export const POST = route(async ({ db, actor, req }) => enrollStudent(db, actor, await body(req, Schema)), { roles: ['admin'] });
