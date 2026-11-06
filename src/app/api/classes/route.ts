import { eq, gte, isNull, or, sql } from 'drizzle-orm';
import { route } from '@/server/http';
import { classes, enrollments, users } from '@/db/schema';
import { melbourneDate } from '@/lib/time';

/** 班级周视图 */
export const GET = route(
  async ({ db }) => {
    const today = melbourneDate(new Date());
    const counts = db
      .select({ classId: enrollments.classId, n: sql<number>`count(*)::int`.as('n') })
      .from(enrollments)
      .where(or(isNull(enrollments.endDate), gte(enrollments.endDate, today)))
      .groupBy(enrollments.classId)
      .as('counts');
    const rows = await db
      .select({ c: classes, teacherName: users.name, enrolled: sql<number>`coalesce(${counts.n}, 0)::int` })
      .from(classes)
      .innerJoin(users, eq(users.id, classes.teacherId))
      .leftJoin(counts, eq(counts.classId, classes.id))
      .where(or(isNull(classes.endsOn), gte(classes.endsOn, today)))
      .orderBy(classes.weekday, classes.startTime);
    return rows.map(({ c, teacherName, enrolled }) => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      level: c.level,
      teacherName,
      weekday: c.weekday,
      startTime: c.startTime.slice(0, 5),
      endTime: c.endTime.slice(0, 5),
      capacity: c.capacity,
      enrolled,
    }));
  },
  { roles: ['admin'] },
);
