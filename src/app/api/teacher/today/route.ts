import { route } from '@/server/http';
import { getTeacherDay } from '@/server/services/attendance';
import { melbourneDate } from '@/lib/time';

export const GET = route(
  async ({ db, actor, req }) => {
    const date = req.nextUrl.searchParams.get('date');
    return getTeacherDay(db, actor, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : melbourneDate(new Date()));
  },
  { roles: ['teacher'] },
);
