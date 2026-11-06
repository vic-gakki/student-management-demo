import { z } from 'zod';
import { body, intParam, route } from '@/server/http';
import { setAvailability } from '@/server/services/students';

const Time = z.string().regex(/^\d{2}:\d{2}$/);
const Schema = z.object({
  slots: z.array(z.object({ weekday: z.number().int().min(1).max(7), fromTime: Time, toTime: Time })).max(14),
});

export const PUT = route(
  async ({ db, actor, params, req }) => setAvailability(db, actor, intParam(params.id), (await body(req, Schema)).slots),
  { roles: ['admin'] },
);
