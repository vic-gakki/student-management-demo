import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { purchasePackage } from '@/server/services/ledger';

const Schema = z.object({
  hours: z.number().int().positive().max(500),
  priceCents: z.number().int().min(0),
  paymentMethod: z.string().min(1).max(30),
  paymentRef: z.string().min(1).max(100),
});

/** 录入续费 / 首次购买 */
export const POST = route(
  async ({ db, actor, params, req }) => purchasePackage(db, actor, { studentId: intParam(params.id), ...(await body(req, Schema)) }),
  { roles: ['admin'] },
);
