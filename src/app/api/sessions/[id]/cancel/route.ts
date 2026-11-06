import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { cancelSession } from '@/server/services/session-admin';

const Schema = z.object({ reason: z.string().max(200).optional() });

/** 停课 */
export const POST = route(
  async ({ db, actor, params, req }) => cancelSession(db, actor, intParam(params.id), (await body(req, Schema)).reason),
  { roles: ['admin'] },
);
