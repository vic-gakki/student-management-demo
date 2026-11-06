import { z } from 'zod';
import { body, route } from '@/server/http';
import { createInquiry, listStudents } from '@/server/services/students';

export const GET = route(
  async ({ db, actor, req }) => {
    const sp = req.nextUrl.searchParams;
    return listStudents(db, actor, {
      scope: sp.get('scope') === 'all' ? 'all' : 'mine',
      q: sp.get('q') || undefined,
      status: sp.get('status') || undefined,
    });
  },
  { roles: ['admin'] },
);

const Time = z.string().regex(/^\d{2}:\d{2}$/);
const InquirySchema = z.object({
  name: z.string().min(1).max(50),
  grade: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
  guardian: z.object({
    name: z.string().min(1).max(50),
    phone: z.string().max(30).optional(),
    wechat: z.string().max(50).optional(),
    relation: z.string().max(20).optional(),
  }),
  subjects: z.array(z.object({ subject: z.string().min(1).max(20), targetLevel: z.string().max(20).optional() })).min(1).max(5),
  availability: z.array(z.object({ weekday: z.number().int().min(1).max(7), fromTime: Time, toTime: Time })).max(14).optional(),
});

/** 咨询登记 */
export const POST = route(async ({ db, actor, req }) => createInquiry(db, actor, await body(req, InquirySchema)), { roles: ['admin'] });
