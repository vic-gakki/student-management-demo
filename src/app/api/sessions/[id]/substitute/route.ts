import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { setSubstitute } from '@/server/services/session-admin';

const Schema = z.object({ teacherId: z.number().int().positive().nullable() });

/** 指定代课老师；teacherId 为 null 表示取消代课 */
export const PUT = route(
  async ({ db, actor, params, req }) => setSubstitute(db, actor, intParam(params.id), (await body(req, Schema)).teacherId),
  { roles: ['admin'] },
);
