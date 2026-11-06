// 老师点名与扣课时。
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  attendance,
  classSessions,
  classes,
  enrollments,
  followUpTasks,
  lessonLedger,
  studentBalances,
  students,
  trialLessons,
  trialSlots,
  trialTemplates,
  type AttendanceStatus,
  type Billing,
} from '@/db/schema';
import { requireRole, type Actor } from '../actor';
import { DomainError, withDbErrors } from '../errors';
import { addDays, melbourneDate, melbourneDateTime, weekStart } from '@/lib/time';
import { balanceFlag, lockBalance, OWED_LIMIT } from './ledger';
import { ensureSessions } from './sessions';

export const MARK_WINDOW_DAYS = 7;
const CHARGEABLE: ReadonlySet<AttendanceStatus> = new Set(['present', 'late', 'absent']);
const NEW_STUDENT_DAYS = 14;

async function loadSession(db: Db, sessionId: number) {
  const [row] = await db
    .select({ s: classSessions, c: classes })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(eq(classSessions.id, sessionId));
  if (!row) throw new DomainError('NOT_FOUND', '课次不存在');
  return row;
}

/** 规则 7：有代课老师时只有代课老师能点名，否则是班级老师 */
function assertTeachesSession(actor: Actor, s: typeof classSessions.$inferSelect, c: typeof classes.$inferSelect) {
  requireRole(actor, 'teacher');
  const teacherId = s.substituteTeacherId ?? c.teacherId;
  if (teacherId !== actor.id) throw new DomainError('FORBIDDEN', '只能给自己（或代课）的课点名');
}

/** 规则 8：课开始后才能点名，7 天内可以修改 */
export function assertMarkWindow(startsAt: Date, now: Date) {
  if (now.getTime() < startsAt.getTime()) throw new DomainError('TOO_EARLY', '课还没开始，不能提前点名');
  if (now.getTime() > startsAt.getTime() + MARK_WINDOW_DAYS * 24 * 3600 * 1000)
    throw new DomainError('WINDOW_CLOSED', `已超过 ${MARK_WINDOW_DAYS} 天，不能再点名或修改`);
}

/** 学生上哪几节课靠推导：该班有报名，且课次日期在报名日期区间内 */
export async function getRoster(db: Db, sessionId: number) {
  const { s, c } = await loadSession(db, sessionId);
  const date = melbourneDate(s.startsAt);
  const rows = await db
    .select({ e: enrollments, st: students, bal: studentBalances })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .leftJoin(studentBalances, eq(studentBalances.studentId, enrollments.studentId))
    .where(
      and(
        eq(enrollments.classId, c.id),
        lte(enrollments.startDate, date),
        or(isNull(enrollments.endDate), gte(enrollments.endDate, date)),
      ),
    )
    .orderBy(students.name);
  const marks = await db.select().from(attendance).where(eq(attendance.sessionId, sessionId));
  const markMap = new Map(marks.map((m) => [m.studentId, m]));
  return {
    session: s,
    cls: c,
    date,
    students: rows.map(({ e, st, bal }) => {
      const m = markMap.get(st.id);
      return {
        studentId: st.id,
        name: st.name,
        grade: st.grade,
        isNew: e.startDate >= addDays(date, -NEW_STUDENT_DAYS),
        // 老师只看标记，不看金额/具体余额（假设 8）
        balanceFlag: balanceFlag(bal?.remainingHours ?? 0, bal?.owedHours ?? 0),
        attendance: m
          ? {
              id: m.id,
              status: m.status,
              billing: m.billing,
              feedbackRaw: m.feedbackRaw,
              feedbackJson: m.feedbackJson,
              llmStatus: m.llmStatus,
              needsFollowUp: m.needsFollowUp,
            }
          : null,
      };
    }),
  };
}

async function createTaskOnce(
  db: Db,
  v: { studentId: number; adminId: number; type: 'owed_hours' | 'teacher_flag' | 'trial_follow_up'; note: string; dueAt: Date; sourceRef: string },
) {
  const [existing] = await db
    .select({ id: followUpTasks.id })
    .from(followUpTasks)
    .where(and(eq(followUpTasks.studentId, v.studentId), eq(followUpTasks.type, v.type), eq(followUpTasks.sourceRef, v.sourceRef), isNull(followUpTasks.doneAt)));
  if (existing) return existing.id;
  const [row] = await db.insert(followUpTasks).values(v).returning({ id: followUpTasks.id });
  return row.id;
}
export { createTaskOnce };

/** 扣 1 节；余额为 0 时记欠课（最多 2 节），超过上限拒绝 */
async function charge(tx: Db, actor: Actor, student: { id: number; name: string; ownerAdminId: number }, attendanceId: number, now: Date): Promise<Billing> {
  const bal = await lockBalance(tx, student.id);
  if (bal.remainingHours > 0) {
    await tx.update(studentBalances).set({ remainingHours: bal.remainingHours - 1 }).where(eq(studentBalances.studentId, student.id));
    await tx.insert(lessonLedger).values({ studentId: student.id, delta: -1, reason: 'attendance', attendanceId, createdBy: actor.id });
    return 'charged';
  }
  // 规则 9：欠课最多 2 节
  if (bal.owedHours >= OWED_LIMIT)
    throw new DomainError('OWED_LIMIT', `${student.name} 已欠 ${bal.owedHours} 节课，不能再记出勤，请联系负责 admin 续费`);
  await tx.update(studentBalances).set({ owedHours: bal.owedHours + 1 }).where(eq(studentBalances.studentId, student.id));
  await createTaskOnce(tx, {
    studentId: student.id,
    adminId: student.ownerAdminId,
    type: 'owed_hours',
    note: '课时已用完，学生仍在上课（欠课），需尽快续费',
    dueAt: now,
    sourceRef: 'owed',
  });
  return 'owed';
}

/** 改点名时撤销之前的扣课：写补偿流水，不改旧流水 */
async function uncharge(tx: Db, actor: Actor, studentId: number, attendanceId: number, prev: Billing) {
  const bal = await lockBalance(tx, studentId);
  if (prev === 'charged' || prev === 'settled') {
    await tx.update(studentBalances).set({ remainingHours: bal.remainingHours + 1 }).where(eq(studentBalances.studentId, studentId));
    await tx.insert(lessonLedger).values({ studentId, delta: 1, reason: 'adjustment', attendanceId, createdBy: actor.id, note: '修改点名，退回课时' });
  } else if (prev === 'owed') {
    await tx.update(studentBalances).set({ owedHours: bal.owedHours - 1 }).where(eq(studentBalances.studentId, studentId));
  }
}

export interface MarkEntry {
  studentId: number;
  status: AttendanceStatus;
  feedback?: string | null;
  needsFollowUp?: boolean;
}

/**
 * 点名并扣课时。整个提交在一个事务里：任何一个学生违反规则，整节课都不写入。
 * 幂等：重复提交同样的点名不会重复扣课（数据库唯一约束兜底）。
 */
export async function markAttendance(db: Db, actor: Actor, sessionId: number, entries: MarkEntry[], now = new Date()) {
  if (entries.length === 0) throw new DomainError('VALIDATION', '点名名单为空');
  const ids = entries.map((e) => e.studentId);
  if (new Set(ids).size !== ids.length) throw new DomainError('VALIDATION', '名单里有重复的学生');

  return withDbErrors(() =>
    db.transaction(async (tx) => {
      const { s, c } = await loadSession(tx, sessionId);
      assertTeachesSession(actor, s, c);
      if (s.status === 'cancelled') throw new DomainError('SESSION_CANCELLED', '这节课已停课，不需要点名');
      assertMarkWindow(s.startsAt, now);

      const roster = await getRoster(tx, sessionId);
      const rosterIds = new Set(roster.students.map((r) => r.studentId));
      for (const e of entries) {
        if (!rosterIds.has(e.studentId)) throw new DomainError('NOT_IN_ROSTER', `学生 ${e.studentId} 不在这节课的名单里`);
      }
      const studentRows = await tx.select().from(students).where(inArray(students.id, ids));
      const byId = new Map(studentRows.map((st) => [st.id, st]));

      const results: { studentId: number; attendanceId: number; billing: Billing }[] = [];
      for (const e of entries) {
        const st = byId.get(e.studentId)!;
        const feedback = e.feedback?.trim() || null;
        const [existing] = await tx
          .select()
          .from(attendance)
          .where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, e.studentId)))
          .for('update');

        let attendanceId: number;
        let billing: Billing;
        if (!existing) {
          const [row] = await tx
            .insert(attendance)
            .values({
              sessionId,
              studentId: e.studentId,
              status: e.status,
              billing: 'free',
              feedbackRaw: feedback,
              needsFollowUp: !!e.needsFollowUp,
              markedBy: actor.id,
            })
            .returning();
          attendanceId = row.id;
          billing = CHARGEABLE.has(e.status) ? await charge(tx, actor, st, attendanceId, now) : 'free';
        } else {
          attendanceId = existing.id;
          const wasCharged = existing.billing !== 'free';
          const shouldCharge = CHARGEABLE.has(e.status);
          billing = existing.billing;
          if (wasCharged && !shouldCharge) {
            await uncharge(tx, actor, e.studentId, attendanceId, existing.billing);
            billing = 'free';
          } else if (!wasCharged && shouldCharge) {
            billing = await charge(tx, actor, st, attendanceId, now);
          }
        }
        await tx
          .update(attendance)
          .set({
            status: e.status,
            billing,
            feedbackRaw: feedback,
            needsFollowUp: !!e.needsFollowUp,
            markedBy: actor.id,
            markedAt: now,
            // 反馈变了就需要重新整理
            ...(existing && existing.feedbackRaw !== feedback ? { llmStatus: 'none' as const, feedbackJson: null } : {}),
          })
          .where(eq(attendance.id, attendanceId));

        if (e.needsFollowUp) {
          await createTaskOnce(tx, {
            studentId: st.id,
            adminId: st.ownerAdminId,
            type: 'teacher_flag',
            note: feedback ? `老师标记需跟进：${feedback}` : '老师标记需跟进',
            dueAt: now,
            sourceRef: `attendance:${attendanceId}`,
          });
        }
        results.push({ studentId: e.studentId, attendanceId, billing });
      }
      await tx.update(classSessions).set({ status: 'done' }).where(eq(classSessions.id, sessionId));
      return { sessionId, results };
    }),
  );
}

/** 老师的"今日课程"：正式课（含代课）+ 试听时段 */
export async function getTeacherDay(db: Db, actor: Actor, date: string) {
  return getTeacherRange(db, actor, date, date);
}

/** 老师的周课表：从 weekStartDate（周一）起 7 天，按天分组 */
export async function getTeacherWeek(db: Db, actor: Actor, anyDate: string) {
  const start = weekStart(anyDate);
  const items = await getTeacherRange(db, actor, start, addDays(start, 6));
  return {
    weekStart: start,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      return { date, items: items.filter((it) => it.date === date) };
    }),
  };
}

async function getTeacherRange(db: Db, actor: Actor, fromDate: string, toDate: string) {
  requireRole(actor, 'teacher');
  // 先按班级规则补齐这段时间的课次，再查询
  await ensureSessions(db, fromDate, toDate);
  const from = melbourneDateTime(fromDate, '00:00');
  const to = melbourneDateTime(addDays(toDate, 1), '00:00');

  const sessions = await db
    .select({ s: classSessions, c: classes })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(
      and(
        gte(classSessions.startsAt, from),
        sql`${classSessions.startsAt} < ${to}`,
        or(
          and(isNull(classSessions.substituteTeacherId), eq(classes.teacherId, actor.id)),
          eq(classSessions.substituteTeacherId, actor.id),
        ),
      ),
    );

  const items = [];
  for (const { s, c } of sessions) {
    const roster = await getRoster(db, s.id);
    items.push({
      kind: 'class' as const,
      id: s.id,
      date: melbourneDate(s.startsAt),
      title: c.name,
      subject: c.subject,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: s.status,
      isSubstitute: s.substituteTeacherId === actor.id,
      studentCount: roster.students.length,
      newCount: roster.students.filter((r) => r.isNew).length,
      markedCount: roster.students.filter((r) => r.attendance).length,
    });
  }

  const slots = await db
    .select({ slot: trialSlots, t: trialTemplates })
    .from(trialSlots)
    .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
    .where(and(eq(trialSlots.teacherId, actor.id), gte(trialSlots.startsAt, from), sql`${trialSlots.startsAt} < ${to}`));
  for (const { slot, t } of slots) {
    const lessons = await db
      .select()
      .from(trialLessons)
      .where(and(eq(trialLessons.slotId, slot.id), sql`${trialLessons.status} <> 'cancelled'`));
    items.push({
      kind: 'trial' as const,
      id: slot.id,
      date: melbourneDate(slot.startsAt),
      title: `试听 · ${t.title}`,
      subject: t.subject,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: lessons.length > 0 && lessons.every((l) => l.status !== 'scheduled') ? 'done' : 'scheduled',
      isSubstitute: false,
      studentCount: lessons.length,
      newCount: lessons.length,
      markedCount: lessons.filter((l) => l.status !== 'scheduled').length,
    });
  }
  return items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
