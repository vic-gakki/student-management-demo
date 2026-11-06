// 排班资格检查：这是排班规则的唯一实现。
// 候选班级列表、手动排班、AI 排班助手的工具、AI 建议的二次校验，全部调用这里。
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { classes, enrollments, studentAvailability, studentBalances, students, users } from '@/db/schema';
import { DomainError } from '../errors';
import { dateRangesOverlap, nextWeekdayOnOrAfter, normTime, timesOverlap, WEEKDAY_LABELS, shortTime } from '@/lib/time';

export type ClassRow = typeof classes.$inferSelect;

export interface Reason {
  code: string;
  message: string;
}

export interface EligibilityContext {
  student: typeof students.$inferSelect;
  remainingHours: number;
  /** 学生当前及未来仍有效的报名（含班级信息） */
  enrollments: { id: number; classId: number; startDate: string; endDate: string | null; cls: ClassRow }[];
  availability: { weekday: number; fromTime: string; toTime: string }[];
}

export interface Evaluation {
  ok: boolean;
  startDate: string;
  reasons: Reason[];
  /** 软性提示（如不在可用时间内），不阻止排班 */
  warnings: Reason[];
}

export async function loadEligibilityContext(db: Db, studentId: number, today: string): Promise<EligibilityContext> {
  const [student] = await db.select().from(students).where(eq(students.id, studentId));
  if (!student) throw new DomainError('NOT_FOUND', '学生不存在');
  const [bal] = await db.select().from(studentBalances).where(eq(studentBalances.studentId, studentId));
  const rows = await db
    .select({ e: enrollments, c: classes })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(eq(enrollments.studentId, studentId), or(isNull(enrollments.endDate), gte(enrollments.endDate, today))));
  const availability = await db
    .select({ weekday: studentAvailability.weekday, fromTime: studentAvailability.fromTime, toTime: studentAvailability.toTime })
    .from(studentAvailability)
    .where(eq(studentAvailability.studentId, studentId));
  return {
    student,
    remainingHours: bal?.remainingHours ?? 0,
    enrollments: rows.map((r) => ({ id: r.e.id, classId: r.e.classId, startDate: r.e.startDate, endDate: r.e.endDate, cls: r.c })),
    availability,
  };
}

/** 某个班在 startDate 那天的在读人数 */
export async function countActiveEnrollments(db: Db, classId: number, onDate: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), or(isNull(enrollments.endDate), gte(enrollments.endDate, onDate))));
  return row?.n ?? 0;
}

export function defaultStartDate(cls: ClassRow, today: string): string {
  const from = cls.startsOn > today ? cls.startsOn : today;
  return nextWeekdayOnOrAfter(from, cls.weekday);
}

export function describeClass(cls: ClassRow): string {
  return `${cls.name}（${WEEKDAY_LABELS[cls.weekday]} ${shortTime(cls.startTime)}-${shortTime(cls.endTime)}）`;
}

/**
 * 纯函数：给定学生上下文、班级、当前人数，判断能不能排进去。
 * excludeClassId 用于转班：检查冲突时排除正在退出的旧班。
 */
export function evaluateEnrollment(
  ctx: EligibilityContext,
  cls: ClassRow,
  activeCount: number,
  startDate: string,
  today: string,
  excludeClassId?: number,
): Evaluation {
  const reasons: Reason[] = [];
  const warnings: Reason[] = [];

  // 规则 15：只有已购买课时包（状态为在读/暂停）的学生才能排进正式班
  if (ctx.student.status !== 'enrolled' && ctx.student.status !== 'paused')
    reasons.push({ code: 'NOT_ENROLLED', message: '学生还没有报名购买课时包，不能排进正式班' });
  // 规则 4：余额为 0 不能排进新班
  if (ctx.remainingHours <= 0) reasons.push({ code: 'INSUFFICIENT_HOURS', message: '课时余额为 0，请先续费' });
  if (startDate < today) reasons.push({ code: 'INVALID_DATE', message: '开始日期不能早于今天' });
  if (cls.endsOn && cls.endsOn < startDate) reasons.push({ code: 'CLASS_ENDED', message: '这个班已经结课' });

  if (ctx.enrollments.some((e) => e.classId === cls.id && e.endDate === null && cls.id !== excludeClassId))
    reasons.push({ code: 'ALREADY_ENROLLED', message: '学生已经在这个班里' });

  // 规则 3：人数上限
  if (activeCount >= cls.capacity) reasons.push({ code: 'CLASS_FULL', message: `班级已满（${activeCount}/${cls.capacity}）` });

  // 规则 2：学生在读班级之间时间不能重叠
  for (const e of ctx.enrollments) {
    if (e.classId === cls.id || e.classId === excludeClassId) continue;
    if (e.cls.weekday !== cls.weekday) continue;
    if (!timesOverlap(e.cls.startTime, e.cls.endTime, cls.startTime, cls.endTime)) continue;
    if (!dateRangesOverlap(startDate, null, e.startDate, e.endDate)) continue;
    reasons.push({ code: 'SCHEDULE_CONFLICT', message: `与"${describeClass(e.cls)}"时间冲突` });
  }

  // 可用时间只是提示，不硬性拦截（家长的时间通常可以商量）
  if (ctx.availability.length > 0) {
    const fits = ctx.availability.some(
      (a) => a.weekday === cls.weekday && normTime(a.fromTime) <= normTime(cls.startTime) && normTime(cls.endTime) <= normTime(a.toTime),
    );
    if (!fits) warnings.push({ code: 'OUTSIDE_AVAILABILITY', message: '不在学生登记的可用时间内' });
  }

  return { ok: reasons.length === 0, startDate, reasons, warnings };
}

/** 单个班的完整检查（读数据库）。排班事务里也调用它。 */
export async function checkEnrollmentEligibility(
  db: Db,
  input: { studentId: number; classId: number; startDate?: string; today: string; excludeClassId?: number },
) {
  const [cls] = await db.select().from(classes).where(eq(classes.id, input.classId));
  if (!cls) throw new DomainError('NOT_FOUND', '班级不存在');
  const ctx = await loadEligibilityContext(db, input.studentId, input.today);
  const startDate = input.startDate ?? defaultStartDate(cls, input.today);
  const count = await countActiveEnrollments(db, cls.id, startDate);
  return { cls, evaluation: evaluateEnrollment(ctx, cls, count, startDate, input.today, input.excludeClassId) };
}

export interface ClassOption {
  classId: number;
  name: string;
  subject: string;
  level: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  enrolled: number;
  startDate: string;
  ok: boolean;
  reasons: Reason[];
  warnings: Reason[];
}

/** 候选班级列表：每个班都标出可报 / 冲突 / 已满等原因 */
export async function listClassOptions(
  db: Db,
  input: { studentId: number; subject?: string; today: string; excludeClassId?: number },
): Promise<ClassOption[]> {
  const ctx = await loadEligibilityContext(db, input.studentId, input.today);
  const rows = await db
    .select({ c: classes, teacherName: users.name })
    .from(classes)
    .innerJoin(users, eq(users.id, classes.teacherId))
    .where(and(input.subject ? eq(classes.subject, input.subject) : undefined, or(isNull(classes.endsOn), gte(classes.endsOn, input.today))));

  const counts = await db
    .select({ classId: enrollments.classId, n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(or(isNull(enrollments.endDate), gte(enrollments.endDate, input.today)))
    .groupBy(enrollments.classId);
  const countMap = new Map(counts.map((c) => [c.classId, c.n]));

  const options = rows.map(({ c, teacherName }) => {
    const startDate = defaultStartDate(c, input.today);
    const enrolled = countMap.get(c.id) ?? 0;
    const ev = evaluateEnrollment(ctx, c, enrolled, startDate, input.today, input.excludeClassId);
    return {
      classId: c.id,
      name: c.name,
      subject: c.subject,
      level: c.level,
      teacherName,
      weekday: c.weekday,
      startTime: shortTime(c.startTime),
      endTime: shortTime(c.endTime),
      capacity: c.capacity,
      enrolled,
      startDate,
      ok: ev.ok,
      reasons: ev.reasons,
      warnings: ev.warnings,
    };
  });
  // 可报的排前面；同为可报时，在可用时间内的排前面
  return options.sort(
    (a, b) =>
      Number(b.ok) - Number(a.ok) ||
      a.warnings.length - b.warnings.length ||
      a.weekday - b.weekday ||
      a.startTime.localeCompare(b.startTime),
  );
}
