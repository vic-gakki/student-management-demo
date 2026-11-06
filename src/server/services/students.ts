import { and, desc, eq, ilike, inArray, isNull, or, sql, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  attendance,
  classSessions,
  classes,
  enrollments,
  followUpTasks,
  guardians,
  lessonLedger,
  studentAvailability,
  studentBalances,
  studentGuardians,
  studentOwnerHistory,
  studentSubjects,
  students,
  trialLessons,
  trialSlots,
  trialTemplates,
  users,
} from '@/db/schema';
import { assertCanModifyStudent, requireRole, type Actor } from '../actor';
import { DomainError } from '../errors';
import { balanceFlag } from './ledger';
import { melbourneDate, normTime } from '@/lib/time';

export async function listStudents(db: Db, actor: Actor, opts: { scope: 'mine' | 'all'; q?: string; status?: string }) {
  requireRole(actor, 'admin');
  const rows = await db
    .select({ st: students, bal: studentBalances, ownerName: users.name })
    .from(students)
    .leftJoin(studentBalances, eq(studentBalances.studentId, students.id))
    .innerJoin(users, eq(users.id, students.ownerAdminId))
    .where(
      and(
        opts.scope === 'mine' ? eq(students.ownerAdminId, actor.id) : undefined,
        opts.q ? ilike(students.name, `%${opts.q}%`) : undefined,
        opts.status ? eq(students.status, opts.status as never) : undefined,
      ),
    )
    .orderBy(students.name)
    .limit(500);
  return rows.map(({ st, bal, ownerName }) => ({
    id: st.id,
    name: st.name,
    grade: st.grade,
    status: st.status,
    ownerAdminId: st.ownerAdminId,
    ownerName,
    canEdit: st.ownerAdminId === actor.id,
    remainingHours: bal?.remainingHours ?? 0,
    owedHours: bal?.owedHours ?? 0,
    balanceFlag: balanceFlag(bal?.remainingHours ?? 0, bal?.owedHours ?? 0),
  }));
}

export async function getStudentDetail(db: Db, actor: Actor, studentId: number, now = new Date()) {
  requireRole(actor, 'admin');
  const today = melbourneDate(now);
  const [row] = await db
    .select({ st: students, ownerName: users.name, bal: studentBalances })
    .from(students)
    .innerJoin(users, eq(users.id, students.ownerAdminId))
    .leftJoin(studentBalances, eq(studentBalances.studentId, students.id))
    .where(eq(students.id, studentId));
  if (!row) throw new DomainError('NOT_FOUND', '学生不存在');

  const [gs, subjects, availability, enrolls, ledger, trials, tasks] = await Promise.all([
    db
      .select({ g: guardians, relation: studentGuardians.relation, isPrimary: studentGuardians.isPrimary })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(eq(studentGuardians.studentId, studentId)),
    db.select().from(studentSubjects).where(eq(studentSubjects.studentId, studentId)),
    db.select().from(studentAvailability).where(eq(studentAvailability.studentId, studentId)).orderBy(studentAvailability.weekday),
    db
      .select({ e: enrollments, c: classes, teacherName: users.name })
      .from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .innerJoin(users, eq(users.id, classes.teacherId))
      .where(and(eq(enrollments.studentId, studentId), or(isNull(enrollments.endDate), gte(enrollments.endDate, today))))
      .orderBy(classes.weekday, classes.startTime),
    db.select().from(lessonLedger).where(eq(lessonLedger.studentId, studentId)).orderBy(desc(lessonLedger.createdAt), desc(lessonLedger.id)).limit(50),
    db
      .select({ l: trialLessons, slot: trialSlots, t: trialTemplates, teacherName: users.name })
      .from(trialLessons)
      .innerJoin(trialSlots, eq(trialSlots.id, trialLessons.slotId))
      .innerJoin(trialTemplates, eq(trialTemplates.id, trialSlots.templateId))
      .innerJoin(users, eq(users.id, trialSlots.teacherId))
      .where(eq(trialLessons.studentId, studentId))
      .orderBy(desc(trialSlots.startsAt)),
    db.select().from(followUpTasks).where(and(eq(followUpTasks.studentId, studentId), isNull(followUpTasks.doneAt))).orderBy(followUpTasks.dueAt),
  ]);

  // 最近的老师反馈
  const feedback = await db
    .select({ a: attendance, startsAt: classSessions.startsAt, className: classes.name })
    .from(attendance)
    .innerJoin(classSessions, eq(classSessions.id, attendance.sessionId))
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(and(eq(attendance.studentId, studentId), sql`${attendance.feedbackRaw} IS NOT NULL`))
    .orderBy(desc(classSessions.startsAt))
    .limit(5);

  const st = row.st;
  return {
    id: st.id,
    name: st.name,
    grade: st.grade,
    status: st.status,
    notes: st.notes,
    lostReason: st.lostReason,
    ownerAdminId: st.ownerAdminId,
    ownerName: row.ownerName,
    canEdit: st.ownerAdminId === actor.id,
    remainingHours: row.bal?.remainingHours ?? 0,
    owedHours: row.bal?.owedHours ?? 0,
    balanceFlag: balanceFlag(row.bal?.remainingHours ?? 0, row.bal?.owedHours ?? 0),
    guardians: gs.map((g) => ({ ...g.g, relation: g.relation, isPrimary: g.isPrimary })),
    subjects,
    availability: availability.map((a) => ({ weekday: a.weekday, fromTime: a.fromTime.slice(0, 5), toTime: a.toTime.slice(0, 5) })),
    enrollments: enrolls.map(({ e, c, teacherName }) => ({
      id: e.id,
      classId: c.id,
      className: c.name,
      subject: c.subject,
      level: c.level,
      teacherName,
      weekday: c.weekday,
      startTime: c.startTime.slice(0, 5),
      endTime: c.endTime.slice(0, 5),
      startDate: e.startDate,
      endDate: e.endDate,
    })),
    ledger,
    trials: trials.map(({ l, slot, t, teacherName }) => ({
      id: l.id,
      subject: l.subject,
      title: t.title,
      teacherName,
      startsAt: slot.startsAt,
      status: l.status,
      outcome: l.outcome,
      suggestedLevel: l.suggestedLevel,
      feedback: l.feedback,
      nextFollowUpAt: l.nextFollowUpAt,
    })),
    tasks,
    recentFeedback: feedback.map((f) => ({
      className: f.className,
      startsAt: f.startsAt,
      status: f.a.status,
      raw: f.a.feedbackRaw,
      structured: f.a.feedbackJson,
    })),
  };
}

export interface InquiryInput {
  name: string;
  grade?: string;
  notes?: string;
  guardian: { name: string; phone?: string; wechat?: string; relation?: string };
  subjects: { subject: string; targetLevel?: string }[];
  availability?: { weekday: number; fromTime: string; toTime: string }[];
}

/** 咨询登记：登记人就是负责人 */
export async function createInquiry(db: Db, actor: Actor, input: InquiryInput) {
  requireRole(actor, 'admin');
  if (!input.name?.trim()) throw new DomainError('VALIDATION', '请填写学生姓名');
  if (!input.guardian?.name?.trim()) throw new DomainError('VALIDATION', '请填写家长姓名');
  if (!input.subjects?.length) throw new DomainError('VALIDATION', '请至少选择一个科目');
  return db.transaction(async (tx) => {
    const [st] = await tx
      .insert(students)
      .values({ name: input.name.trim(), grade: input.grade?.trim() || null, notes: input.notes?.trim() || null, ownerAdminId: actor.id, status: 'lead' })
      .returning();
    const [g] = await tx
      .insert(guardians)
      .values({ name: input.guardian.name.trim(), phone: input.guardian.phone || null, wechat: input.guardian.wechat || null })
      .returning();
    await tx.insert(studentGuardians).values({ studentId: st.id, guardianId: g.id, relation: input.guardian.relation || null, isPrimary: true });
    const uniqueSubjects = [...new Map(input.subjects.map((s) => [s.subject, s])).values()];
    await tx.insert(studentSubjects).values(uniqueSubjects.map((s) => ({ studentId: st.id, subject: s.subject, targetLevel: s.targetLevel || null })));
    await tx.insert(studentBalances).values({ studentId: st.id });
    if (input.availability?.length) await replaceAvailabilityTx(tx, st.id, input.availability);
    await tx.insert(studentOwnerHistory).values({ studentId: st.id, fromAdmin: null, toAdmin: actor.id, reason: '咨询登记' });
    return st;
  });
}

async function replaceAvailabilityTx(tx: Db, studentId: number, slots: { weekday: number; fromTime: string; toTime: string }[]) {
  for (const s of slots) {
    if (!(s.weekday >= 1 && s.weekday <= 7)) throw new DomainError('VALIDATION', '星期几不正确');
    if (!/^\d{2}:\d{2}$/.test(s.fromTime) || !/^\d{2}:\d{2}$/.test(s.toTime) || normTime(s.fromTime) >= normTime(s.toTime))
      throw new DomainError('VALIDATION', '可用时间格式不正确或开始晚于结束');
  }
  await tx.delete(studentAvailability).where(eq(studentAvailability.studentId, studentId));
  if (slots.length) await tx.insert(studentAvailability).values(slots.map((s) => ({ studentId, ...s })));
}

export async function setAvailability(db: Db, actor: Actor, studentId: number, slots: { weekday: number; fromTime: string; toTime: string }[]) {
  return db.transaction(async (tx) => {
    await assertCanModifyStudent(tx, actor, studentId, true);
    await replaceAvailabilityTx(tx, studentId, slots);
    return tx.select().from(studentAvailability).where(eq(studentAvailability.studentId, studentId));
  });
}

export async function completeTask(db: Db, actor: Actor, taskId: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(followUpTasks).where(eq(followUpTasks.id, taskId));
    if (!task) throw new DomainError('NOT_FOUND', '待办不存在');
    await assertCanModifyStudent(tx, actor, task.studentId, true);
    const [row] = await tx.update(followUpTasks).set({ doneAt: now }).where(eq(followUpTasks.id, taskId)).returning();
    return row;
  });
}

/** 按姓名查学生及其在读班级（AI 工具"和某同学一个班"用） */
export async function findStudentsByName(db: Db, name: string, today: string) {
  const rows = await db.select().from(students).where(ilike(students.name, `%${name}%`)).limit(5);
  if (!rows.length) return [];
  const es = await db
    .select({ e: enrollments, c: classes })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(inArray(enrollments.studentId, rows.map((r) => r.id)), or(isNull(enrollments.endDate), gte(enrollments.endDate, today))));
  return rows.map((r) => ({
    studentId: r.id,
    name: r.name,
    grade: r.grade,
    classes: es.filter((x) => x.e.studentId === r.id).map((x) => ({ classId: x.c.id, name: x.c.name, subject: x.c.subject })),
  }));
}
