import { route } from '@/server/http';
import { getTeacherWeek } from '@/server/services/attendance';
import { melbourneDate } from '@/lib/time';

/** 老师周课表：?date=任意一天，返回那一周（周一到周日） */
export const GET = route(
  async ({ db, actor, req }) => {
    const date = req.nextUrl.searchParams.get('date');
    return getTeacherWeek(db, actor, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : melbourneDate(new Date()));
  },
  { roles: ['teacher'] },
);
