import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { followUpTasks, lessonLedger, students } from '@/db/schema';
import { bookTrial, createTrialSlot, markTrialAttendance, recordTrialOutcome } from '@/server/services/trials';
import { createInquiry } from '@/server/services/students';
import { getAdminDashboard } from '@/server/services/dashboard';
import { at, createTestDb, expectCode, makeClass, makeEnrollment, makeSession, makeStudent, makeTemplate, makeUser, TUESDAY } from './helpers';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

const now = at(TUESDAY, '09:00');

async function newLead(admin: Awaited<ReturnType<typeof makeUser>>, name = '小明') {
  return createInquiry(h.db, admin, {
    name,
    grade: '五年级',
    guardian: { name: '王女士', phone: '0400000000', relation: '妈妈' },
    subjects: [{ subject: '数学' }],
  });
}

describe('咨询 → 试听 → 跟进', () => {
  it('完整流程：登记、建时段、安排、点名生成跟进待办、记录结果', async () => {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const tpl = await makeTemplate(h.db, '数学');
    const lead = await newLead(admin);
    expect(lead.status).toBe('lead');
    expect(lead.ownerAdminId).toBe(admin.id);

    const slot = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-12', '10:00'), capacity: 2 }, now);
    const lesson = await bookTrial(h.db, admin, { studentId: lead.id, slotId: slot.id }, now);
    const [afterBook] = await h.db.select().from(students).where(eq(students.id, lead.id));
    expect(afterBook.status).toBe('trial');

    // 跟进结果不能在上课前记录
    await expectCode(recordTrialOutcome(h.db, admin, lesson.id, { outcome: 'enrolled' }, now), 'INVALID_STATE');

    const after = at('2026-11-12', '10:50');
    await markTrialAttendance(h.db, teacher, slot.id, [{ trialLessonId: lesson.id, status: 'attended', feedback: '基础不错', suggestedLevel: '提高' }], after);
    const tasks = await h.db
      .select()
      .from(followUpTasks)
      .where(and(eq(followUpTasks.studentId, lead.id), eq(followUpTasks.type, 'trial_follow_up'), isNull(followUpTasks.doneAt)));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].adminId).toBe(admin.id);
    expect(tasks[0].dueAt.getTime() - after.getTime()).toBe(2 * 864e5);
    // 试听不扣课时
    expect(await h.db.select().from(lessonLedger).where(eq(lessonLedger.studentId, lead.id))).toHaveLength(0);

    // 考虑中：关闭旧待办并生成新的跟进日期
    await recordTrialOutcome(h.db, admin, lesson.id, { outcome: 'thinking', nextFollowUpAt: at('2026-11-20', '10:00') }, after);
    const open = await h.db.select().from(followUpTasks).where(and(eq(followUpTasks.studentId, lead.id), isNull(followUpTasks.doneAt)));
    expect(open).toHaveLength(1);
    expect(open[0].dueAt.toISOString()).toBe(at('2026-11-20', '10:00').toISOString());

    await recordTrialOutcome(h.db, admin, lesson.id, { outcome: 'lost', lostReason: '价格' }, after);
    const [lost] = await h.db.select().from(students).where(eq(students.id, lead.id));
    expect(lost.status).toBe('churned');
  });

  it('规则 12：每科只能试听一次；缺席的可以重新安排', async () => {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const tpl = await makeTemplate(h.db, '数学');
    const lead = await newLead(admin, '小红');
    const s1 = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-13', '10:00') }, now);
    const s2 = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-14', '10:00') }, now);
    const l1 = await bookTrial(h.db, admin, { studentId: lead.id, slotId: s1.id }, now);
    await expectCode(bookTrial(h.db, admin, { studentId: lead.id, slotId: s2.id }, now), 'TRIAL_ALREADY_USED');
    await markTrialAttendance(h.db, teacher, s1.id, [{ trialLessonId: l1.id, status: 'no_show' }], at('2026-11-13', '10:30'));
    await bookTrial(h.db, admin, { studentId: lead.id, slotId: s2.id }, at('2026-11-13', '11:00'));
  });

  it('规则 13：试听时段不能和老师的正式课冲突；时段人数上限；只能安排在未来', async () => {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const tpl = await makeTemplate(h.db, '英语', 60);
    // 周四 16:00-17:00 正式课
    await makeClass(h.db, { teacherId: teacher.id, weekday: 4, start: '16:00', end: '17:00' });
    await expectCode(
      createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-12', '15:30') }, now),
      'TEACHER_BUSY',
    );
    await expectCode(
      createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-01', '10:00') }, now),
      'INVALID_DATE',
    );
    const slot = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-12', '17:00') }, now);
    // 与另一个试听时段重叠
    await expectCode(
      createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-12', '17:30') }, now),
      'TEACHER_BUSY',
    );
    const a = await newLead(admin, '甲');
    const b = await newLead(admin, '乙');
    await bookTrial(h.db, admin, { studentId: a.id, slotId: slot.id }, now);
    await expectCode(bookTrial(h.db, admin, { studentId: b.id, slotId: slot.id }, now), 'SLOT_FULL');
  });

  it('规则 13：学生加入试听时不能和自己的在读班级冲突', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t1.id, weekday: 5, start: '16:00', end: '17:00' });
    const st = await makeStudent(h.db, admin);
    await makeEnrollment(h.db, st.id, cls.id, admin.id);
    const tpl = await makeTemplate(h.db, '编程');
    const slot = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: t2.id, startsAt: at('2026-11-13', '16:30') }, now);
    await expectCode(bookTrial(h.db, admin, { studentId: st.id, slotId: slot.id }, now), 'SCHEDULE_CONFLICT');
  });

  it('老师代课的那节课不算正式课冲突', async () => {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const sub = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: teacher.id, weekday: 3, start: '16:00', end: '17:00' });
    await makeSession(h.db, cls, '2026-11-11', { substituteTeacherId: sub.id });
    const tpl = await makeTemplate(h.db, '科学');
    await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-11', '16:00') }, now);
    await expectCode(
      createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: sub.id, startsAt: at('2026-11-11', '16:15') }, now),
      'TEACHER_BUSY',
    );
  });

  it('非负责 admin 不能安排试听；老师不能给别人的试听点名', async () => {
    const admin = await makeUser(h.db, 'admin');
    const other = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const stranger = await makeUser(h.db, 'teacher');
    const tpl = await makeTemplate(h.db, '数学');
    const lead = await newLead(admin, '丙');
    const slot = await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2026-11-16', '10:00') }, now);
    await expectCode(bookTrial(h.db, other, { studentId: lead.id, slotId: slot.id }, now), 'FORBIDDEN');
    const l = await bookTrial(h.db, admin, { studentId: lead.id, slotId: slot.id }, now);
    await expectCode(markTrialAttendance(h.db, stranger, slot.id, [{ trialLessonId: l.id, status: 'attended' }], at('2026-11-16', '10:30')), 'FORBIDDEN');
  });
});

describe('工作台', () => {
  it('咨询超过 3 天未安排试听、课时快用完、欠课都出现在负责 admin 的工作台', async () => {
    const admin = await makeUser(h.db, 'admin');
    const lead = await newLead(admin, '老咨询');
    await h.db.update(students).set({ createdAt: at('2026-11-01', '10:00') }).where(eq(students.id, lead.id));
    await makeStudent(h.db, admin, { name: '剩两节', hours: 2 });
    await makeStudent(h.db, admin, { name: '欠一节', hours: 0, owed: 1 });
    await makeStudent(h.db, admin, { name: '很多课', hours: 30 });
    const d = await getAdminDashboard(h.db, admin, now);
    expect(d.followUps.map((f) => f.studentName)).toContain('老咨询');
    expect(d.lowBalance.map((l) => l.studentName)).toEqual(['欠一节', '剩两节']);
    const other = await makeUser(h.db, 'admin');
    const d2 = await getAdminDashboard(h.db, other, now);
    expect(d2.lowBalance).toHaveLength(0);
  });
});
