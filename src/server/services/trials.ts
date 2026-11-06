// 试听：独立的试听时段 + 每科固定的试听内容（见 DESIGN.md 第 3 部分"咨询和试听"）。
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  classSessions,
  classes,
  enrollments,
  followUpTasks,
  studentSubjects,
  students,
  trialLessons,
  trialSlots,
  trialTemplates,
  users,
} from '@/db/schema';
import { assertCanModifyStudent, requireRole, type Actor } from '../actor';
import { DomainError, withDbErrors } from '../errors';
import { addDays, isoWeekday, melbourneDate, melbourneDateTime, melbourneTime, shortTime, timesOverlap } from '@/lib/time';

const describeTime = (from: string, to: string) => `${shortTime(from)}-${shortTime(to)}`;
import { assertMarkWindow, createTaskOnce } from './attendance';

const FOLLOW_UP_DAYS = 2;
const DAY_MS = 24 * 3600 * 1000;

export async function listTrialTemplates(db: Db) {
  return db.select().from(trialTemplates).orderBy(trialTemplates.subject);
}

/** 某科目未来、还有空位的试听时段 */
export async function listOpenTrialSlots(db: Db, subject: string | undefined, now = new Date()) {
  const rows = await db
    .select({ slot: trialSlots, t: trialTemplates, teacherName: users.name })
    .from(trialSlots)
    .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
    .innerJoin(users, eq(users.id, trialSlots.teacherId))
    .where(and(gte(trialSlots.startsAt, now), subject ? eq(trialTemplates.subject, subject) : undefined))
    .orderBy(trialSlots.startsAt);
  const ids = rows.map((r) => r.slot.id);
  const counts = ids.length
    ? await db
        .select({ slotId: trialLessons.slotId, n: sql<number>`count(*)::int` })
        .from(trialLessons)
        .where(and(inArray(trialLessons.slotId, ids), sql`${trialLessons.status} <> 'cancelled'`))
        .groupBy(trialLessons.slotId)
    : [];
  const countMap = new Map(counts.map((c) => [c.slotId, c.n]));
  return rows.map((r) => ({
    id: r.slot.id,
    templateTitle: r.t.title,
    subject: r.t.subject,
    teacherName: r.teacherName,
    startsAt: r.slot.startsAt,
    endsAt: r.slot.endsAt,
    capacity: r.slot.capacity,
    booked: countMap.get(r.slot.id) ?? 0,
  }));
}

/**
 * 规则 13：老师在这段时间不能有正式课（含代课）或其他试听。
 * 跨"周期班级"和"一次性试听"两类时间，数据库约束表达不了，所以在服务端检查。
 */
export async function findTeacherConflicts(db: Db, teacherId: number, startsAt: Date, endsAt: Date, excludeSlotId?: number) {
  const date = melbourneDate(startsAt);
  const wd = isoWeekday(date);
  const from = melbourneTime(startsAt);
  const to = melbourneTime(endsAt);
  const conflicts: string[] = [];

  const weekly = await db
    .select()
    .from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.weekday, wd), lte(classes.startsOn, date), or(isNull(classes.endsOn), gte(classes.endsOn, date))));
  for (const c of weekly) {
    if (!timesOverlap(c.startTime, c.endTime, from, to)) continue;
    // 当天这节课如果停课或由别人代课，老师就是空闲的
    const [s] = await db
      .select()
      .from(classSessions)
      .where(and(eq(classSessions.classId, c.id), sql`(${classSessions.startsAt} AT TIME ZONE 'Australia/Melbourne')::date = ${date}::date`));
    if (s && (s.status === 'cancelled' || (s.substituteTeacherId && s.substituteTeacherId !== teacherId))) continue;
    conflicts.push(`正式课 ${c.name} ${describeTime(c.startTime, c.endTime)}`);
  }

  const subs = await db
    .select({ s: classSessions, c: classes })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(and(eq(classSessions.substituteTeacherId, teacherId), sql`${classSessions.startsAt} < ${endsAt}`, sql`${classSessions.endsAt} > ${startsAt}`));
  for (const { c } of subs) conflicts.push(`代课 ${c.name}`);

  const slots = await db
    .select()
    .from(trialSlots)
    .where(and(eq(trialSlots.teacherId, teacherId), sql`${trialSlots.startsAt} < ${endsAt}`, sql`${trialSlots.endsAt} > ${startsAt}`));
  for (const s of slots) if (s.id !== excludeSlotId) conflicts.push(`其他试听 ${melbourneTime(s.startsAt)}`);
  return conflicts;
}

export async function createTrialSlot(
  db: Db,
  actor: Actor,
  input: { templateId: number; teacherId: number; startsAt: Date; capacity?: number },
  now = new Date(),
) {
  requireRole(actor, 'admin');
  return withDbErrors(() =>
    db.transaction(async (tx) => {
      const [t] = await tx.select().from(trialTemplates).where(eq(trialTemplates.id, input.templateId));
      if (!t) throw new DomainError('NOT_FOUND', '试听内容不存在');
      const [teacher] = await tx.select().from(users).where(eq(users.id, input.teacherId)).for('update');
      if (!teacher || teacher.role !== 'teacher') throw new DomainError('NOT_FOUND', '老师不存在');
      if (input.startsAt.getTime() <= now.getTime()) throw new DomainError('INVALID_DATE', '只能安排在未来');
      const endsAt = new Date(input.startsAt.getTime() + t.durationMin * 60 * 1000);
      const conflicts = await findTeacherConflicts(tx, input.teacherId, input.startsAt, endsAt);
      if (conflicts.length) throw new DomainError('TEACHER_BUSY', `${teacher.name} 这个时间没空：${conflicts.join('；')}`);
      const [row] = await tx
        .insert(trialSlots)
        .values({ templateId: t.id, teacherId: input.teacherId, startsAt: input.startsAt, endsAt, capacity: input.capacity ?? 1, createdBy: actor.id })
        .returning();
      return row;
    }),
  );
}

/** 安排试听：检查人数、未来、学生时间冲突、每科一次 */
export async function bookTrial(db: Db, actor: Actor, input: { studentId: number; slotId: number }, now = new Date()) {
  return withDbErrors(() =>
    db.transaction(async (tx) => {
      const student = await assertCanModifyStudent(tx, actor, input.studentId, true);
      const [row] = await tx
        .select({ slot: trialSlots, t: trialTemplates })
        .from(trialSlots)
        .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
        .where(eq(trialSlots.id, input.slotId))
        .for('update', { of: trialSlots });
      if (!row) throw new DomainError('NOT_FOUND', '试听时段不存在');
      const { slot, t } = row;
      if (slot.startsAt.getTime() <= now.getTime()) throw new DomainError('INVALID_DATE', '这个试听时段已经开始或结束');

      const [cnt] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(trialLessons)
        .where(and(eq(trialLessons.slotId, slot.id), sql`${trialLessons.status} <> 'cancelled'`));
      if ((cnt?.n ?? 0) >= slot.capacity) throw new DomainError('SLOT_FULL', '这个试听时段已满');

      const conflicts = await findStudentConflicts(tx, student.id, slot.startsAt, slot.endsAt);
      if (conflicts.length) throw new DomainError('SCHEDULE_CONFLICT', `与学生已有安排冲突：${conflicts.join('；')}`);

      const [lesson] = await tx
        .insert(trialLessons)
        .values({ studentId: student.id, slotId: slot.id, subject: t.subject, createdBy: actor.id })
        .returning();

      if (student.status === 'lead') await tx.update(students).set({ status: 'trial' }).where(eq(students.id, student.id));
      await tx
        .insert(studentSubjects)
        .values({ studentId: student.id, subject: t.subject, status: 'trial' })
        .onConflictDoUpdate({
          target: [studentSubjects.studentId, studentSubjects.subject],
          set: { status: sql`CASE WHEN ${studentSubjects.status} = 'active' THEN 'active' ELSE 'trial' END` },
        });
      return lesson;
    }),
  );
}

async function findStudentConflicts(db: Db, studentId: number, startsAt: Date, endsAt: Date) {
  const date = melbourneDate(startsAt);
  const wd = isoWeekday(date);
  const from = melbourneTime(startsAt);
  const to = melbourneTime(endsAt);
  const out: string[] = [];
  const rows = await db
    .select({ c: classes })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(eq(enrollments.studentId, studentId), eq(classes.weekday, wd), lte(enrollments.startDate, date), or(isNull(enrollments.endDate), gte(enrollments.endDate, date))));
  for (const { c } of rows) if (timesOverlap(c.startTime, c.endTime, from, to)) out.push(`正式课 ${c.name}`);
  const trials = await db
    .select({ l: trialLessons })
    .from(trialLessons)
    .innerJoin(trialSlots, eq(trialSlots.id, trialLessons.slotId))
    .where(and(eq(trialLessons.studentId, studentId), eq(trialLessons.status, 'scheduled'), sql`${trialSlots.startsAt} < ${endsAt}`, sql`${trialSlots.endsAt} > ${startsAt}`));
  for (const { l } of trials) out.push(`另一节试听（${l.subject}）`);
  return out;
}

export async function getTrialSlotRoster(db: Db, actor: Actor, slotId: number) {
  const [row] = await db
    .select({ slot: trialSlots, t: trialTemplates })
    .from(trialSlots)
    .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
    .where(eq(trialSlots.id, slotId));
  if (!row) throw new DomainError('NOT_FOUND', '试听时段不存在');
  if (actor.role === 'teacher' && row.slot.teacherId !== actor.id) throw new DomainError('FORBIDDEN', '只能查看自己的试听');
  const lessons = await db
    .select({ l: trialLessons, st: students })
    .from(trialLessons)
    .innerJoin(students, eq(students.id, trialLessons.studentId))
    .where(and(eq(trialLessons.slotId, slotId), sql`${trialLessons.status} <> 'cancelled'`));
  return {
    slot: row.slot,
    template: row.t,
    lessons: lessons.map(({ l, st }) => ({
      trialLessonId: l.id,
      studentId: st.id,
      name: st.name,
      grade: st.grade,
      status: l.status,
      feedback: l.feedback,
      suggestedLevel: l.suggestedLevel,
    })),
  };
}

export interface TrialMarkEntry {
  trialLessonId: number;
  status: 'attended' | 'no_show';
  feedback?: string | null;
  suggestedLevel?: string | null;
}

/** 规则 14：试听出勤后必须生成跟进待办（同一事务）；试听不扣课时 */
export async function markTrialAttendance(db: Db, actor: Actor, slotId: number, entries: TrialMarkEntry[], now = new Date()) {
  requireRole(actor, 'teacher');
  return db.transaction(async (tx) => {
    const [slot] = await tx.select().from(trialSlots).where(eq(trialSlots.id, slotId));
    if (!slot) throw new DomainError('NOT_FOUND', '试听时段不存在');
    if (slot.teacherId !== actor.id) throw new DomainError('FORBIDDEN', '只能给自己的试听点名');
    assertMarkWindow(slot.startsAt, now);

    const results = [];
    for (const e of entries) {
      const [row] = await tx
        .select({ l: trialLessons, st: students })
        .from(trialLessons)
        .innerJoin(students, eq(students.id, trialLessons.studentId))
        .where(and(eq(trialLessons.id, e.trialLessonId), eq(trialLessons.slotId, slotId)));
      if (!row || row.l.status === 'cancelled') throw new DomainError('NOT_IN_ROSTER', `试听记录 ${e.trialLessonId} 不在这个时段里`);
      await tx
        .update(trialLessons)
        .set({ status: e.status, feedback: e.feedback?.trim() || null, suggestedLevel: e.suggestedLevel?.trim() || null })
        .where(eq(trialLessons.id, row.l.id));
      await createTaskOnce(tx, {
        studentId: row.st.id,
        adminId: row.st.ownerAdminId,
        type: 'trial_follow_up',
        note: e.status === 'attended' ? `试听已完成（${row.l.subject}），请在 ${FOLLOW_UP_DAYS} 天内跟进` : `试听缺席（${row.l.subject}），请重新安排`,
        dueAt: new Date(now.getTime() + FOLLOW_UP_DAYS * DAY_MS),
        sourceRef: `trial:${row.l.id}`,
      });
      results.push({ trialLessonId: row.l.id, status: e.status });
    }
    return { slotId, results };
  });
}

/** 记录试听跟进结果：报名 / 考虑中 / 放弃 */
export async function recordTrialOutcome(
  db: Db,
  actor: Actor,
  trialLessonId: number,
  input: { outcome: 'enrolled' | 'thinking' | 'lost'; nextFollowUpAt?: Date; lostReason?: string },
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [lesson] = await tx.select().from(trialLessons).where(eq(trialLessons.id, trialLessonId));
    if (!lesson) throw new DomainError('NOT_FOUND', '试听记录不存在');
    const student = await assertCanModifyStudent(tx, actor, lesson.studentId, true);
    if (lesson.status === 'scheduled' || lesson.status === 'cancelled')
      throw new DomainError('INVALID_STATE', '试听还没上，不能记录跟进结果');

    // 关闭这节试听的跟进待办
    await tx
      .update(followUpTasks)
      .set({ doneAt: now })
      .where(and(eq(followUpTasks.sourceRef, `trial:${lesson.id}`), isNull(followUpTasks.doneAt)));

    if (input.outcome === 'thinking') {
      if (!input.nextFollowUpAt || input.nextFollowUpAt.getTime() <= now.getTime())
        throw new DomainError('VALIDATION', '"考虑中"需要设置一个未来的下次跟进日期');
      await tx.insert(followUpTasks).values({
        studentId: student.id,
        adminId: student.ownerAdminId,
        type: 'trial_follow_up',
        note: `家长考虑中（${lesson.subject}），按约定再次跟进`,
        dueAt: input.nextFollowUpAt,
        sourceRef: `trial:${lesson.id}`,
      });
    }
    if (input.outcome === 'lost') {
      if (!input.lostReason?.trim()) throw new DomainError('VALIDATION', '请填写放弃原因');
      await tx
        .update(studentSubjects)
        .set({ status: 'stopped' })
        .where(and(eq(studentSubjects.studentId, student.id), eq(studentSubjects.subject, lesson.subject)));
      if (student.status === 'lead' || student.status === 'trial')
        await tx.update(students).set({ status: 'churned', lostReason: input.lostReason.trim() }).where(eq(students.id, student.id));
    }
    const [row] = await tx
      .update(trialLessons)
      .set({ outcome: input.outcome, nextFollowUpAt: input.outcome === 'thinking' ? input.nextFollowUpAt : null })
      .where(eq(trialLessons.id, lesson.id))
      .returning();
    return row;
  });
}

/** 试听安排（admin）：日期范围内的全部试听时段，含已约学生与状态 */
export async function listTrialSchedule(db: Db, actor: Actor, opts: { from: string; to: string; subject?: string }) {
  requireRole(actor, 'admin');
  if (opts.to < opts.from) throw new DomainError('VALIDATION', '结束日期不能早于开始日期');
  const fromAt = melbourneDateTime(opts.from, '00:00');
  const toAt = melbourneDateTime(addDays(opts.to, 1), '00:00');
  const rows = await db
    .select({ slot: trialSlots, t: trialTemplates, teacherName: users.name })
    .from(trialSlots)
    .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
    .innerJoin(users, eq(users.id, trialSlots.teacherId))
    .where(and(gte(trialSlots.startsAt, fromAt), sql`${trialSlots.startsAt} < ${toAt}`, opts.subject ? eq(trialTemplates.subject, opts.subject) : undefined))
    .orderBy(trialSlots.startsAt);
  const ids = rows.map((r) => r.slot.id);
  const lessons = ids.length
    ? await db
        .select({ l: trialLessons, st: students })
        .from(trialLessons)
        .innerJoin(students, eq(students.id, trialLessons.studentId))
        .where(and(inArray(trialLessons.slotId, ids), sql`${trialLessons.status} <> 'cancelled'`))
    : [];
  return rows.map(({ slot, t, teacherName }) => {
    const ls = lessons.filter((x) => x.l.slotId === slot.id);
    return {
      id: slot.id,
      date: melbourneDate(slot.startsAt),
      startTime: melbourneTime(slot.startsAt),
      endTime: melbourneTime(slot.endsAt),
      startsAt: slot.startsAt,
      subject: t.subject,
      title: t.title,
      teacherId: slot.teacherId,
      teacherName,
      capacity: slot.capacity,
      booked: ls.length,
      students: ls.map(({ l, st }) => ({
        trialLessonId: l.id,
        studentId: st.id,
        name: st.name,
        status: l.status,
        outcome: l.outcome,
        isMine: st.ownerAdminId === actor.id,
      })),
    };
  });
}
