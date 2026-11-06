// Admin 工作台：三列待办——需跟进 / 课时快用完 / 本周新入班
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { classes, enrollments, followUpTasks, studentBalances, students, trialLessons } from '@/db/schema';
import { requireRole, type Actor } from '../actor';
import { addDays, melbourneDate, weekStart } from '@/lib/time';
import { balanceFlag, LOW_BALANCE_THRESHOLD } from './ledger';

export const INQUIRY_TRIAL_DAYS = 3;

export async function getAdminDashboard(db: Db, actor: Actor, now = new Date()) {
  requireRole(actor, 'admin');
  const today = melbourneDate(now);

  const tasks = await db
    .select({ t: followUpTasks, name: students.name })
    .from(followUpTasks)
    .innerJoin(students, eq(students.id, followUpTasks.studentId))
    .where(and(eq(followUpTasks.adminId, actor.id), isNull(followUpTasks.doneAt), lte(followUpTasks.dueAt, new Date(now.getTime() + 7 * 864e5))))
    .orderBy(asc(followUpTasks.dueAt));

  // 咨询超过 3 天还没安排试听
  const staleLeads = await db
    .select({ id: students.id, name: students.name, createdAt: students.createdAt })
    .from(students)
    .where(
      and(
        eq(students.ownerAdminId, actor.id),
        eq(students.status, 'lead'),
        lte(students.createdAt, new Date(now.getTime() - INQUIRY_TRIAL_DAYS * 864e5)),
        sql`NOT EXISTS (SELECT 1 FROM ${trialLessons} WHERE ${trialLessons.studentId} = ${students.id} AND ${trialLessons.status} IN ('scheduled','attended'))`,
      ),
    )
    .orderBy(asc(students.createdAt));

  const followUps = [
    ...tasks.map(({ t, name }) => ({
      key: `task-${t.id}`,
      taskId: t.id as number | null,
      studentId: t.studentId,
      studentName: name,
      type: t.type as string,
      note: t.note,
      dueAt: t.dueAt,
      overdue: t.dueAt.getTime() < now.getTime(),
    })),
    ...staleLeads.map((l) => ({
      key: `lead-${l.id}`,
      taskId: null,
      studentId: l.id,
      studentName: l.name,
      type: 'inquiry_no_trial',
      note: `咨询已 ${Math.floor((now.getTime() - l.createdAt.getTime()) / 864e5)} 天，还没安排试听`,
      dueAt: new Date(l.createdAt.getTime() + INQUIRY_TRIAL_DAYS * 864e5),
      overdue: true,
    })),
  ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  const lowRows = await db
    .select({ st: students, bal: studentBalances })
    .from(students)
    .innerJoin(studentBalances, eq(studentBalances.studentId, students.id))
    .where(
      and(
        eq(students.ownerAdminId, actor.id),
        inArray(students.status, ['enrolled', 'paused']),
        or(sql`${studentBalances.owedHours} > 0`, lte(studentBalances.remainingHours, LOW_BALANCE_THRESHOLD)),
      ),
    )
    .orderBy(sql`${studentBalances.owedHours} DESC`, asc(studentBalances.remainingHours), asc(students.name));
  const lowBalance = lowRows.map(({ st, bal }) => ({
    studentId: st.id,
    studentName: st.name,
    remainingHours: bal.remainingHours,
    owedHours: bal.owedHours,
    flag: balanceFlag(bal.remainingHours, bal.owedHours),
  }));

  const ws = weekStart(today);
  const newRows = await db
    .select({ e: enrollments, st: students, c: classes })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(eq(students.ownerAdminId, actor.id), gte(enrollments.startDate, ws), lte(enrollments.startDate, addDays(ws, 6))))
    .orderBy(asc(enrollments.startDate));
  const newThisWeek = newRows.map(({ e, st, c }) => ({
    studentId: st.id,
    studentName: st.name,
    className: c.name,
    weekday: c.weekday,
    startTime: c.startTime.slice(0, 5),
    startDate: e.startDate,
  }));

  const [cnt] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(students)
    .where(and(eq(students.ownerAdminId, actor.id), inArray(students.status, ['lead', 'trial', 'enrolled', 'paused'])));

  return { myStudentCount: cnt?.n ?? 0, followUps, lowBalance, newThisWeek };
}
