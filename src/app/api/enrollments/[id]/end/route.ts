import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { endEnrollment } from '@/server/services/enrollment';

const Schema = z.object({ endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** 退班 */
export const POST = route(
  async ({ db, actor, params, req }) => endEnrollment(db, actor, intParam(params.id), (await body(req, Schema)).endDate),
  { roles: ['admin'] },
);
