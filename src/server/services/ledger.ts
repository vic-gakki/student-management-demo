// 课时 = 钱。所有余额变化都在这里：先写流水（只追加），再在同一事务里更新余额缓存。
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  attendance,
  enrollments,
  followUpTasks,
  lessonLedger,
  lessonPackages,
  studentBalances,
  students,
} from '@/db/schema';
import { assertCanModifyStudent, type Actor } from '../actor';
import { DomainError, withDbErrors } from '../errors';
import { melbourneDate } from '@/lib/time';

export const LOW_BALANCE_THRESHOLD = 3;
export const OWED_LIMIT = 2;

/** 锁住余额行（没有就创建），后续扣减都基于锁住的值 */
export async function lockBalance(db: Db, studentId: number) {
  await db.insert(studentBalances).values({ studentId }).onConflictDoNothing();
  const [bal] = await db.select().from(studentBalances).where(eq(studentBalances.studentId, studentId)).for('update');
  return bal;
}

export interface PurchaseInput {
  studentId: number;
  hours: number;
  priceCents: number;
  paymentMethod: string;
  paymentRef: string;
}

/**
 * 录入续费 / 首次购买。
 * 同一事务：写课时包 → 写增加课时的流水 → 先补扣欠的课 → 更新余额 → 关闭欠课待办 → 学生状态改为在读。
 */
export async function purchasePackage(db: Db, actor: Actor, input: PurchaseInput) {
  if (!Number.isInteger(input.hours) || input.hours <= 0) throw new DomainError('VALIDATION', '课时数必须是正整数');
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new DomainError('VALIDATION', '金额不能为负');
  if (!input.paymentRef.trim()) throw new DomainError('VALIDATION', '请填写付款凭证号');

  return withDbErrors(() =>
    db.transaction(async (tx) => {
      const student = await assertCanModifyStudent(tx, actor, input.studentId, true);
      const bal = await lockBalance(tx, input.studentId);

      const [pkg] = await tx
        .insert(lessonPackages)
        .values({
          studentId: input.studentId,
          hours: input.hours,
          priceCents: input.priceCents,
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef.trim(),
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(lessonLedger).values({
        studentId: input.studentId,
        packageId: pkg.id,
        delta: input.hours,
        reason: 'purchase',
        createdBy: actor.id,
        note: `购买 ${input.hours} 节`,
      });

      // 补扣欠课：最早欠的先补
      const settle = Math.min(bal.owedHours, input.hours);
      if (settle > 0) {
        const owedRows = await tx
          .select()
          .from(attendance)
          .where(and(eq(attendance.studentId, input.studentId), eq(attendance.billing, 'owed')))
          .orderBy(asc(attendance.markedAt))
          .limit(settle);
        for (const a of owedRows) {
          await tx.update(attendance).set({ billing: 'settled' }).where(eq(attendance.id, a.id));
          await tx.insert(lessonLedger).values({
            studentId: input.studentId,
            packageId: pkg.id,
            delta: -1,
            reason: 'attendance',
            attendanceId: a.id,
            createdBy: actor.id,
            note: '续费后补扣欠课',
          });
        }
      }

      const [newBal] = await tx
        .update(studentBalances)
        .set({ remainingHours: bal.remainingHours + input.hours - settle, owedHours: bal.owedHours - settle })
        .where(eq(studentBalances.studentId, input.studentId))
        .returning();

      await tx
        .update(followUpTasks)
        .set({ doneAt: new Date() })
        .where(and(eq(followUpTasks.studentId, input.studentId), eq(followUpTasks.type, 'owed_hours'), isNull(followUpTasks.doneAt)));

      if (student.status !== 'enrolled') {
        await tx.update(students).set({ status: 'enrolled', lostReason: null }).where(eq(students.id, input.studentId));
      }
      return { package: pkg, balance: newBal, settledOwed: settle };
    }),
  );
}

/**
 * 退费：剩余课时 × 课时包单价（从最近购买的课时包往前算），写一条退费流水。
 * 余额清零；没有在读班级时学生状态改为流失。
 */
export async function refundRemaining(db: Db, actor: Actor, input: { studentId: number; reason: string }, now = new Date()) {
  if (!input.reason?.trim()) throw new DomainError('VALIDATION', '请填写退费原因');
  return db.transaction(async (tx) => {
    await assertCanModifyStudent(tx, actor, input.studentId, true);
    const bal = await lockBalance(tx, input.studentId);
    if (bal.remainingHours <= 0) throw new DomainError('NOTHING_TO_REFUND', '没有可退的剩余课时');

    const pkgs = await tx
      .select()
      .from(lessonPackages)
      .where(eq(lessonPackages.studentId, input.studentId))
      .orderBy(desc(lessonPackages.purchasedAt), desc(lessonPackages.id));
    let left = bal.remainingHours;
    let amount = 0;
    for (const p of pkgs) {
      if (left <= 0) break;
      const take = Math.min(left, p.hours);
      amount += Math.round((p.priceCents / p.hours) * take);
      left -= take;
    }

    await tx.insert(lessonLedger).values({
      studentId: input.studentId,
      packageId: pkgs[0]?.id ?? null,
      delta: -bal.remainingHours,
      reason: 'refund',
      amountCents: amount,
      createdBy: actor.id,
      note: input.reason.trim(),
    });
    await tx.update(studentBalances).set({ remainingHours: 0 }).where(eq(studentBalances.studentId, input.studentId));

    const today = melbourneDate(now);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(eq(enrollments.studentId, input.studentId), sql`(${enrollments.endDate} IS NULL OR ${enrollments.endDate} >= ${today})`));
    if ((open?.n ?? 0) === 0) {
      await tx.update(students).set({ status: 'churned', lostReason: input.reason.trim() }).where(eq(students.id, input.studentId));
    }
    return { refundedHours: bal.remainingHours, amountCents: amount };
  });
}

export function balanceFlag(remaining: number, owed: number): 'ok' | 'low' | 'out' | 'owed' {
  if (owed > 0) return 'owed';
  if (remaining <= 0) return 'out';
  if (remaining <= LOW_BALANCE_THRESHOLD) return 'low';
  return 'ok';
}
