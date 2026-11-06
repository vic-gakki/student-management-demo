import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { markTrialAttendance } from '@/server/services/trials';

const Schema = z.object({
  entries: z
    .array(
      z.object({
        trialLessonId: z.number().int().positive(),
        status: z.enum(['attended', 'no_show']),
        feedback: z.string().max(1000).nullable().optional(),
        suggestedLevel: z.string().max(20).nullable().optional(),
      }),
    )
    .min(1),
});

export const POST = route(
  async ({ db, actor, params, req }) => markTrialAttendance(db, actor, intParam(params.id), (await body(req, Schema)).entries),
  { roles: ['teacher'] },
);
