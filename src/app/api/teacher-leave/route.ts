import { z } from 'zod';
import { body, route } from '@/server/http';
import { applyTeacherLeave } from '@/server/services/session-admin';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Schema = z.object({
  teacherId: z.number().int().positive(),
  from: DATE,
  to: DATE,
  action: z.enum(['cancel', 'substitute']),
  substituteTeacherId: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
});

/** 老师请假：批量停课或批量代课，逐节返回结果 */
export const POST = route(async ({ db, actor, req }) => applyTeacherLeave(db, actor, await body(req, Schema)), { roles: ['admin'] });
