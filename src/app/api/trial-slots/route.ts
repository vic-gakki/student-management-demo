import { z } from 'zod';
import { body, route } from '@/server/http';
import { createTrialSlot, listOpenTrialSlots } from '@/server/services/trials';
import { melbourneDateTime } from '@/lib/time';

export const GET = route(async ({ db, req }) => listOpenTrialSlots(db, req.nextUrl.searchParams.get('subject') || undefined), {
  roles: ['admin'],
});

const Schema = z.object({
  templateId: z.number().int().positive(),
  teacherId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().min(1).max(6).optional(),
});

/** 新建试听时段（日期时间按墨尔本本地时间） */
export const POST = route(
  async ({ db, actor, req }) => {
    const v = await body(req, Schema);
    return createTrialSlot(db, actor, { templateId: v.templateId, teacherId: v.teacherId, startsAt: melbourneDateTime(v.date, v.time), capacity: v.capacity });
  },
  { roles: ['admin'] },
);
