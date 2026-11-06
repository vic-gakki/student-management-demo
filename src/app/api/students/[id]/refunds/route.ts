import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { refundRemaining } from '@/server/services/ledger';

const Schema = z.object({ reason: z.string().min(1).max(200) });

export const POST = route(
  async ({ db, actor, params, req }) => refundRemaining(db, actor, { studentId: intParam(params.id), ...(await body(req, Schema)) }),
  { roles: ['admin'] },
);
