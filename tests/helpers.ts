// 测试工具：每个测试文件一个内存 PGlite（真实 PostgreSQL），跑真实迁移和约束。
import { eq } from 'drizzle-orm';
import { migrate, openPglite, type Db, type DbHandle } from '@/db/client';
import {
  classSessions,
  classes,
  enrollments,
  lessonLedger,
  lessonPackages,
  studentBalances,
  students,
  trialTemplates,
  users,
} from '@/db/schema';
import type { Actor } from '@/server/actor';
import { melbourneDateTime } from '@/lib/time';

export async function createTestDb(): Promise<DbHandle> {
  const handle = await openPglite();
  await migrate(handle);
  return handle;
}

let seq = 0;

export async function makeUser(db: Db, role: 'admin' | 'teacher', name?: string): Promise<Actor> {
  const n = ++seq;
  const [u] = await db
    .insert(users)
    .values({ email: `${role}${n}@test.local`, passwordHash: 'x', name: name ?? `${role}${n}`, role })
    .returning();
  return { id: u.id, role: u.role, name: u.name };
}

export async function makeClass(
  db: Db,
  v: { teacherId: number; weekday: number; start: string; end: string; capacity?: number; subject?: string; name?: string; startsOn?: string },
) {
  const [c] = await db
    .insert(classes)
    .values({
      name: v.name ?? `${v.subject ?? '数学'}班 ${v.weekday} ${v.start}`,
      subject: v.subject ?? '数学',
      level: '提高',
      teacherId: v.teacherId,
      weekday: v.weekday,
      startTime: v.start,
      endTime: v.end,
      capacity: v.capacity ?? 8,
      startsOn: v.startsOn ?? '2026-01-01',
    })
    .returning();
  return c;
}

/** 直接造一个学生（含余额），绕过服务层，便于构造各种状态 */
export async function makeStudent(
  db: Db,
  owner: Actor,
  v: { name?: string; status?: 'lead' | 'trial' | 'enrolled'; hours?: number; owed?: number } = {},
) {
  const n = ++seq; // 先取出序号，避免并发调用时 await 之后读到别人的值
  const [st] = await db
    .insert(students)
    .values({ name: v.name ?? `学生${n}`, ownerAdminId: owner.id, status: v.status ?? 'enrolled' })
    .returning();
  const hours = v.hours ?? 10;
  await db.insert(studentBalances).values({ studentId: st.id, remainingHours: hours, owedHours: v.owed ?? 0 });
  if (hours > 0) {
    const [pkg] = await db
      .insert(lessonPackages)
      .values({ studentId: st.id, hours, priceCents: hours * 5000, paymentMethod: 'test', paymentRef: `seed-${n}`, createdBy: owner.id })
      .returning();
    await db.insert(lessonLedger).values({ studentId: st.id, packageId: pkg.id, delta: hours, reason: 'purchase', createdBy: owner.id });
  }
  return st;
}

export async function makeEnrollment(db: Db, studentId: number, classId: number, createdBy: number, startDate = '2026-01-05') {
  const [e] = await db.insert(enrollments).values({ studentId, classId, startDate, createdBy }).returning();
  return e;
}

/** 某个班在某天的课次（墨尔本时间） */
export async function makeSession(db: Db, cls: typeof classes.$inferSelect, date: string, extra: { substituteTeacherId?: number } = {}) {
  const [s] = await db
    .insert(classSessions)
    .values({
      classId: cls.id,
      startsAt: melbourneDateTime(date, cls.startTime),
      endsAt: melbourneDateTime(date, cls.endTime),
      substituteTeacherId: extra.substituteTeacherId ?? null,
    })
    .returning();
  return s;
}

export async function makeTemplate(db: Db, subject = '数学', durationMin = 45) {
  const [t] = await db
    .insert(trialTemplates)
    .values({ subject, level: '通用', title: `${subject}试听课`, outline: '固定内容', durationMin })
    .returning();
  return t;
}

export async function balanceOf(db: Db, studentId: number) {
  const [b] = await db.select().from(studentBalances).where(eq(studentBalances.studentId, studentId));
  return b;
}

export async function ledgerSum(db: Db, studentId: number) {
  const rows = await db.select().from(lessonLedger).where(eq(lessonLedger.studentId, studentId));
  return rows.reduce((s, r) => s + r.delta, 0);
}

/** 期望 promise 以指定业务错误码失败 */
export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    const c = (err as { code?: string }).code;
    if (c !== code) throw new Error(`期望错误码 ${code}，实际 ${c}: ${(err as Error).message}`);
    return err;
  }
  throw new Error(`期望错误码 ${code}，但操作成功了`);
}

/** 期望数据库报错，错误信息（含 drizzle 包装下的 cause）匹配 pattern */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (err) {
    const text = [(err as Error).message, ((err as { cause?: Error }).cause)?.message].join(' | ');
    if (!pattern.test(text)) throw new Error(`错误信息不匹配 ${pattern}: ${text}`);
    return;
  }
  throw new Error('期望数据库报错，但操作成功了');
}

// 2026-11-10 是周二；测试里统一用固定的"现在"
export const TUESDAY = '2026-11-10';
export const at = (date: string, time: string) => melbourneDateTime(date, time);
