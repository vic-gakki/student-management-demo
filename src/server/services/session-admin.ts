// 单节课的调整：停课、恢复、代课，以及"老师请假"批量处理。
// 规则：只能调整还没开始、也没有点名记录的课；代课老师在这个时间必须有空。
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '@/db/client';
import { attendance, classSessions, classes, users } from '@/db/schema';
import { requireRole, type Actor } from '../actor';
import { DomainError } from '../errors';
import { addDays, melbourneDate, melbourneDateTime, melbourneTime } from '@/lib/time';
import { ensureSessions } from './sessions';
import { findTeacherConflicts } from './trials';

export interface SessionView {
  id: number;
  classId: number;
  className: string;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: Date;
  status: 'scheduled' | 'cancelled' | 'done';
  note: string | null;
  teacherId: number;
  teacherName: string;
  substituteTeacherId: number | null;
  substituteName: string | null;
  markedCount: number;
}

const MAX_RANGE_DAYS = 62;

/** 某个日期范围的课次（可按班级、老师过滤）；查询前先补齐课次 */
export async function listSessions(db: Db, actor: Actor, opts: { from: string; to: string; classId?: number; teacherId?: number }): Promise<SessionView[]> {
  requireRole(actor, 'admin');
  if (opts.to < opts.from) throw new DomainError('VALIDATION', '结束日期不能早于开始日期');
  if (addDays(opts.from, MAX_RANGE_DAYS) < opts.to) throw new DomainError('VALIDATION', `一次最多查询 ${MAX_RANGE_DAYS} 天`);
  await ensureSessions(db, opts.from, opts.to);
  const sub = alias(users, 'sub');
  const rows = await db
    .select({ s: classSessions, c: classes, teacherName: users.name, substituteName: sub.name })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .innerJoin(users, eq(users.id, classes.teacherId))
    .leftJoin(sub, eq(sub.id, classSessions.substituteTeacherId))
    .where(
      and(
        gte(classSessions.startsAt, melbourneDateTime(opts.from, '00:00')),
        sql`${classSessions.startsAt} < ${melbourneDateTime(addDays(opts.to, 1), '00:00')}`,
        opts.classId ? eq(classSessions.classId, opts.classId) : undefined,
        // 这位老师本班的课（含已被别人代的）+ 他给别人代的课
        opts.teacherId ? or(eq(classes.teacherId, opts.teacherId), eq(classSessions.substituteTeacherId, opts.teacherId)) : undefined,
      ),
    )
    .orderBy(classSessions.startsAt);
  const ids = rows.map((r) => r.s.id);
  const marks = ids.length
    ? await db
        .select({ sessionId: attendance.sessionId, n: sql<number>`count(*)::int` })
        .from(attendance)
        .where(inArray(attendance.sessionId, ids))
        .groupBy(attendance.sessionId)
    : [];
  const markMap = new Map(marks.map((m) => [m.sessionId, m.n]));
  return rows.map(({ s, c, teacherName, substituteName }) => ({
    id: s.id,
    classId: c.id,
    className: c.name,
    subject: c.subject,
    date: melbourneDate(s.startsAt),
    startTime: melbourneTime(s.startsAt),
    endTime: melbourneTime(s.endsAt),
    startsAt: s.startsAt,
    status: s.status,
    note: s.note,
    teacherId: c.teacherId,
    teacherName,
    substituteTeacherId: s.substituteTeacherId,
    substituteName: substituteName ?? null,
    markedCount: markMap.get(s.id) ?? 0,
  }));
}

async function lockSession(db: Db, sessionId: number) {
  const [row] = await db
    .select({ s: classSessions, c: classes })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(eq(classSessions.id, sessionId))
    .for('update', { of: classSessions });
  if (!row) throw new DomainError('NOT_FOUND', '课次不存在');
  return row;
}

/** 已开始或已有点名记录的课不能再调整（否则会影响已经扣过的课时） */
async function assertAdjustable(db: Db, s: typeof classSessions.$inferSelect, now: Date) {
  if (s.startsAt.getTime() <= now.getTime()) throw new DomainError('INVALID_STATE', '这节课已经开始或结束，不能再调整');
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(attendance).where(eq(attendance.sessionId, s.id));
  if ((m?.n ?? 0) > 0) throw new DomainError('INVALID_STATE', '这节课已有点名记录，不能再调整');
}

/** 停课：全班这节课不上、不扣课时；老师的课表显示已停课 */
export async function cancelSession(db: Db, actor: Actor, sessionId: number, reason: string | undefined, now = new Date()) {
  requireRole(actor, 'admin');
  return db.transaction(async (tx) => {
    const { s } = await lockSession(tx, sessionId);
    if (s.status === 'cancelled') throw new DomainError('INVALID_STATE', '这节课已经停课');
    await assertAdjustable(tx, s, now);
    const [row] = await tx
      .update(classSessions)
      .set({ status: 'cancelled', substituteTeacherId: null, note: reason?.trim() || null })
      .where(eq(classSessions.id, sessionId))
      .returning();
    return row;
  });
}

/** 恢复上课 */
export async function restoreSession(db: Db, actor: Actor, sessionId: number, now = new Date()) {
  requireRole(actor, 'admin');
  return db.transaction(async (tx) => {
    const { s } = await lockSession(tx, sessionId);
    if (s.status !== 'cancelled') throw new DomainError('INVALID_STATE', '这节课没有停课');
    if (s.startsAt.getTime() <= now.getTime()) throw new DomainError('INVALID_STATE', '这节课的时间已经过了，不能恢复');
    const [row] = await tx.update(classSessions).set({ status: 'scheduled', note: null }).where(eq(classSessions.id, sessionId)).returning();
    return row;
  });
}

/**
 * 指定代课老师（teacherId 为 null 时取消代课）。
 * 代课老师在这个时间不能有正式课、其他代课或试听；冲突检查复用试听时段的同一个函数。
 */
export async function setSubstitute(db: Db, actor: Actor, sessionId: number, teacherId: number | null, now = new Date()) {
  requireRole(actor, 'admin');
  return db.transaction(async (tx) => {
    const { s, c } = await lockSession(tx, sessionId);
    if (s.status === 'cancelled') throw new DomainError('INVALID_STATE', '这节课已经停课，不能指定代课');
    await assertAdjustable(tx, s, now);
    // 重复提交同一位代课老师：幂等返回（否则冲突检查会把这节课本身当成冲突）
    if (teacherId === s.substituteTeacherId) return s;
    if (teacherId !== null) {
      if (teacherId === c.teacherId) throw new DomainError('VALIDATION', '代课老师不能是这个班原来的老师');
      // 锁住代课老师行：同一位老师的两个代课请求排队执行，避免同一时间被安排两节
      const [t] = await tx.select().from(users).where(eq(users.id, teacherId)).for('update');
      if (!t || t.role !== 'teacher') throw new DomainError('NOT_FOUND', '老师不存在');
      const conflicts = await findTeacherConflicts(tx, teacherId, s.startsAt, s.endsAt);
      if (conflicts.length) throw new DomainError('TEACHER_BUSY', `${t.name} 这个时间没空：${conflicts.join('；')}`);
    }
    const [row] = await tx.update(classSessions).set({ substituteTeacherId: teacherId }).where(eq(classSessions.id, sessionId)).returning();
    return row;
  });
}

export interface LeaveResult {
  sessionId: number;
  className: string;
  date: string;
  startTime: string;
  ok: boolean;
  message?: string;
}

/**
 * 老师请假：把这位老师在 [from, to] 内自己的课批量停课，或批量指定同一位代课老师。
 * 每节课单独执行、单独返回结果：有冲突的课不影响其他课，admin 可以再逐节处理。
 */
export async function applyTeacherLeave(
  db: Db,
  actor: Actor,
  input: { teacherId: number; from: string; to: string; action: 'cancel' | 'substitute'; substituteTeacherId?: number; reason?: string },
  now = new Date(),
): Promise<LeaveResult[]> {
  requireRole(actor, 'admin');
  if (input.action === 'substitute' && !input.substituteTeacherId) throw new DomainError('VALIDATION', '请选择代课老师');
  if (input.action === 'substitute' && input.substituteTeacherId === input.teacherId) throw new DomainError('VALIDATION', '代课老师不能是请假的老师本人');
  const sessions = await listSessions(db, actor, { from: input.from, to: input.to, teacherId: input.teacherId });
  const results: LeaveResult[] = [];
  for (const s of sessions) {
    // 只处理这位老师本人的课（不包括他给别人代的课），已停课的跳过
    if (s.teacherId !== input.teacherId || s.status === 'cancelled') continue;
    const base = { sessionId: s.id, className: s.className, date: s.date, startTime: s.startTime };
    try {
      if (input.action === 'cancel') await cancelSession(db, actor, s.id, input.reason || '老师请假', now);
      else await setSubstitute(db, actor, s.id, input.substituteTeacherId!, now);
      results.push({ ...base, ok: true });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      results.push({ ...base, ok: false, message: err.message });
    }
  }
  return results;
}
