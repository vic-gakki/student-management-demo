import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { recordTrialOutcome } from '@/server/services/trials';
import { melbourneDateTime } from '@/lib/time';

const Schema = z.object({
  outcome: z.enum(['enrolled', 'thinking', 'lost']),
  nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lostReason: z.string().max(200).optional(),
});

export const POST = route(
  async ({ db, actor, params, req }) => {
    const v = await body(req, Schema);
    return recordTrialOutcome(db, actor, intParam(params.id), {
      outcome: v.outcome,
      nextFollowUpAt: v.nextFollowUpDate ? melbourneDateTime(v.nextFollowUpDate, '09:00') : undefined,
      lostReason: v.lostReason,
    });
  },
  { roles: ['admin'] },
);
