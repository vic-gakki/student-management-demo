import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { classes, enrollments, scheduleSuggestions, studentSubjects } from '@/db/schema';
import { assertCanModifyStudent, type Actor } from '../actor';
import { DomainError, withDbErrors } from '../errors';
import { checkEnrollmentEligibility } from './eligibility';
import { addDays, melbourneDate } from '@/lib/time';

export interface EnrollInput {
  studentId: number;
  classId: number;
  startDate?: string;
  /** 转班：同一事务里结束旧班，冲突检查时排除旧班 */
  transferFromClassId?: number;
  /** 来自 AI 排班建议时带上建议 id，用于留痕 */
  suggestionId?: number;
}

/**
 * 把学生排进一个周班。
 * 并发安全：先锁学生行（同一学生的排班请求排队），再锁班级行（同一班级的人数计数排队），
 * 然后在同一事务里重新跑一遍全部规则再写入。
 */
export async function enrollStudent(db: Db, actor: Actor, input: EnrollInput, now = new Date()) {
  const today = melbourneDate(now);
  return withDbErrors(() =>
    db.transaction(async (tx) => {
      await assertCanModifyStudent(tx, actor, input.studentId, true);
      const [lockedClass] = await tx.select().from(classes).where(eq(classes.id, input.classId)).for('update');
      if (!lockedClass) throw new DomainError('NOT_FOUND', '班级不存在');

      const { cls, evaluation } = await checkEnrollmentEligibility(tx, {
        studentId: input.studentId,
        classId: input.classId,
        startDate: input.startDate,
        today,
        excludeClassId: input.transferFromClassId,
      });
      if (!evaluation.ok) {
        const first = evaluation.reasons[0];
        throw new DomainError(first.code as never, evaluation.reasons.map((r) => r.message).join('；'), evaluation.reasons);
      }

      if (input.transferFromClassId) {
        const [old] = await tx
          .select()
          .from(enrollments)
          .where(
            and(
              eq(enrollments.studentId, input.studentId),
              eq(enrollments.classId, input.transferFromClassId),
              isNull(enrollments.endDate),
            ),
          )
          .for('update');
        if (!old) throw new DomainError('INVALID_STATE', '学生不在要转出的班级里');
        if (old.startDate >= evaluation.startDate) {
          // 旧报名还没生效过（没有任何一节课），直接撤销；出勤挂在课次上，不受影响
          await tx.delete(enrollments).where(eq(enrollments.id, old.id));
        } else {
          await tx.update(enrollments).set({ endDate: addDays(evaluation.startDate, -1) }).where(eq(enrollments.id, old.id));
        }
      }

      const [row] = await tx
        .insert(enrollments)
        .values({ studentId: input.studentId, classId: cls.id, startDate: evaluation.startDate, createdBy: actor.id })
        .returning();

      // 科目需求状态同步为"在读"
      await tx
        .insert(studentSubjects)
        .values({ studentId: input.studentId, subject: cls.subject, status: 'active' })
        .onConflictDoUpdate({ target: [studentSubjects.studentId, studentSubjects.subject], set: { status: 'active' } });

      if (input.suggestionId) {
        await tx
          .update(scheduleSuggestions)
          .set({ status: 'accepted', acceptedClassId: cls.id })
          .where(and(eq(scheduleSuggestions.id, input.suggestionId), eq(scheduleSuggestions.studentId, input.studentId)));
      }
      return { enrollment: row, warnings: evaluation.warnings };
    }),
  );
}

/** 退班：设置结束日期，之后的课次自动不再包含这个学生，余额不变 */
export async function endEnrollment(db: Db, actor: Actor, enrollmentId: number, endDate?: string, now = new Date()) {
  const today = melbourneDate(now);
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
    if (!e) throw new DomainError('NOT_FOUND', '报名记录不存在');
    await assertCanModifyStudent(tx, actor, e.studentId, true);
    if (e.endDate !== null) throw new DomainError('INVALID_STATE', '这条报名已经结束');
    const end = endDate ?? today;
    if (end < e.startDate) throw new DomainError('INVALID_DATE', '结束日期不能早于开始日期');
    const [row] = await tx.update(enrollments).set({ endDate: end }).where(eq(enrollments.id, enrollmentId)).returning();
    return row;
  });
}
