import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { classSessions } from '@/db/schema';
import { ensureSessions } from '@/server/services/sessions';
import { getTeacherDay, getTeacherWeek } from '@/server/services/attendance';
import { applyTeacherLeave, cancelSession, listSessions, restoreSession, setSubstitute } from '@/server/services/session-admin';
import { markAttendance } from '@/server/services/attendance';
import { createTrialSlot } from '@/server/services/trials';
import { at, createTestDb, expectCode, makeClass, makeEnrollment, makeStudent, makeTemplate, makeUser } from './helpers';
import { melbourneTime } from '@/lib/time';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe('按需生成课次', () => {
  it('只在开课到结课之间、对应星期几生成；重复调用不重复生成', async () => {
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 3, start: '16:00', end: '17:00', startsOn: '2027-01-06' });
    // 2027-01-01 ~ 2027-01-31：周三是 6、13、20、27 号
    expect(await ensureSessions(h.db, '2027-01-01', '2027-01-31')).toBeGreaterThanOrEqual(4);
    const rows = await h.db.select().from(classSessions).where(eq(classSessions.classId, cls.id));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => melbourneTime(r.startsAt) === '16:00')).toBe(true);
    expect(await ensureSessions(h.db, '2027-01-01', '2027-01-31')).toBe(0);
    // 开课之前不生成
    await ensureSessions(h.db, '2026-12-01', '2027-01-05');
    expect(await h.db.select().from(classSessions).where(eq(classSessions.classId, cls.id))).toHaveLength(4);
  });

  it('不会覆盖已调整过的课次（停课、代课）', async () => {
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 1, start: '10:00', end: '11:00', startsOn: '2027-02-01' });
    await ensureSessions(h.db, '2027-02-01', '2027-02-07');
    await h.db.update(classSessions).set({ status: 'cancelled' }).where(eq(classSessions.classId, cls.id));
    await ensureSessions(h.db, '2027-02-01', '2027-02-07');
    const [s] = await h.db.select().from(classSessions).where(eq(classSessions.classId, cls.id));
    expect(s.status).toBe('cancelled');
  });

  it('跨夏令时（墨尔本 2026-10-04）生成的课次本地时刻不变', async () => {
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 2, start: '16:00', end: '17:00', startsOn: '2026-09-01' });
    await ensureSessions(h.db, '2026-09-28', '2026-10-11');
    const rows = await h.db.select().from(classSessions).where(eq(classSessions.classId, cls.id)).orderBy(classSessions.startsAt);
    expect(rows.map((r) => r.startsAt.toISOString())).toEqual(['2026-09-29T06:00:00.000Z', '2026-10-06T05:00:00.000Z']);
  });
});

describe('老师课表', () => {
  it('很远的未来也能看到课（按需生成），按周一到周日分组', async () => {
    const t = await makeUser(h.db, 'teacher');
    await makeClass(h.db, { teacherId: t.id, weekday: 5, start: '17:30', end: '18:30', name: '远期班', startsOn: '2026-01-01' });
    const week = await getTeacherWeek(h.db, t, '2027-06-16'); // 周三
    expect(week.weekStart).toBe('2027-06-14');
    expect(week.days).toHaveLength(7);
    expect(week.days[4].items.map((i) => i.title)).toEqual(['远期班']);
    expect(week.days.filter((d) => d.items.length > 0)).toHaveLength(1);
  });

  it('代课的课出现在代课老师的课表上，不出现在原老师的课表上', async () => {
    const t = await makeUser(h.db, 'teacher');
    const sub = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 4, start: '19:00', end: '20:00', name: '代课班', startsOn: '2026-01-01' });
    await ensureSessions(h.db, '2027-03-04', '2027-03-04');
    await h.db
      .update(classSessions)
      .set({ substituteTeacherId: sub.id })
      .where(and(eq(classSessions.classId, cls.id)));
    expect((await getTeacherDay(h.db, t, '2027-03-04')).map((i) => i.title)).toEqual([]);
    const subDay = await getTeacherDay(h.db, sub, '2027-03-04');
    expect(subDay.map((i) => [i.title, i.isSubstitute])).toEqual([['代课班', true]]);
  });
});

describe('停课、代课与老师请假', () => {
  // 2027-03-01 是周一；"现在"定在这天早上
  const now = at('2027-03-01', '08:00');

  async function setup() {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: teacher.id, weekday: 3, start: '16:00', end: '17:00', startsOn: '2027-01-01', name: '调整班' });
    const sessions = await listSessions(h.db, admin, { from: '2027-03-01', to: '2027-03-21', classId: cls.id });
    return { admin, teacher, cls, sessions };
  }

  it('停课：未来的课可以停课并记录原因；停课后不能点名；可以恢复', async () => {
    const { admin, teacher, cls, sessions } = await setup();
    expect(sessions.map((s) => s.date)).toEqual(['2027-03-03', '2027-03-10', '2027-03-17']);
    const target = sessions[0];
    const row = await cancelSession(h.db, admin, target.id, '学校活动', now);
    expect(row.status).toBe('cancelled');
    expect(row.note).toBe('学校活动');
    await expectCode(cancelSession(h.db, admin, target.id, undefined, now), 'INVALID_STATE');

    const st = await makeStudent(h.db, admin);
    await makeEnrollment(h.db, st.id, cls.id, admin.id, '2027-01-06');
    await expectCode(markAttendance(h.db, teacher, target.id, [{ studentId: st.id, status: 'present' }], at('2027-03-03', '16:10')), 'SESSION_CANCELLED');

    expect((await restoreSession(h.db, admin, target.id, now)).status).toBe('scheduled');
  });

  it('已经开始或已有点名记录的课不能调整；老师不能调用', async () => {
    const { admin, teacher, cls, sessions } = await setup();
    await expectCode(cancelSession(h.db, admin, sessions[0].id, undefined, at('2027-03-03', '16:30')), 'INVALID_STATE');
    const st = await makeStudent(h.db, admin);
    await makeEnrollment(h.db, st.id, cls.id, admin.id, '2027-01-06');
    await markAttendance(h.db, teacher, sessions[0].id, [{ studentId: st.id, status: 'present' }], at('2027-03-03', '16:10'));
    // 假设时间回到课前（例如时钟偏差），已有点名记录仍然不能停课
    await expectCode(cancelSession(h.db, admin, sessions[0].id, undefined, now), 'INVALID_STATE');
    await expectCode(cancelSession(h.db, teacher, sessions[1].id, undefined, now), 'FORBIDDEN');
  });

  it('代课：不能是本班老师；代课老师这个时间要有空；停课的课不能代课；重复指定幂等', async () => {
    const { admin, teacher, sessions } = await setup();
    const busy = await makeUser(h.db, 'teacher');
    await makeClass(h.db, { teacherId: busy.id, weekday: 3, start: '16:30', end: '17:30', startsOn: '2027-01-01' });
    const free = await makeUser(h.db, 'teacher');

    await expectCode(setSubstitute(h.db, admin, sessions[0].id, teacher.id, now), 'VALIDATION');
    await expectCode(setSubstitute(h.db, admin, sessions[0].id, busy.id, now), 'TEACHER_BUSY');
    const row = await setSubstitute(h.db, admin, sessions[0].id, free.id, now);
    expect(row.substituteTeacherId).toBe(free.id);
    await setSubstitute(h.db, admin, sessions[0].id, free.id, now); // 幂等

    // 代课老师这个时间已被占用：不能再给他排同一时间的试听
    const tpl = await makeTemplate(h.db, '数学', 45);
    await expectCode(createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: free.id, startsAt: at('2027-03-03', '16:15') }, now), 'TEACHER_BUSY');
    // 原老师这节课空出来了，可以排试听
    await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: teacher.id, startsAt: at('2027-03-03', '16:00') }, now);

    // 取消代课
    expect((await setSubstitute(h.db, admin, sessions[0].id, null, now)).substituteTeacherId).toBeNull();

    await cancelSession(h.db, admin, sessions[1].id, undefined, now);
    await expectCode(setSubstitute(h.db, admin, sessions[1].id, free.id, now), 'INVALID_STATE');
  });

  it('老师请假：批量代课逐节返回结果，有冲突的那节单独失败；批量停课只动这位老师本班的课', async () => {
    const { admin, teacher, cls } = await setup();
    const other = await makeUser(h.db, 'teacher');
    const otherCls = await makeClass(h.db, { teacherId: other.id, weekday: 3, start: '09:00', end: '10:00', startsOn: '2027-01-01' });
    const sub = await makeUser(h.db, 'teacher');
    // 代课老师 3 月 10 日已经有一个 16:00 的试听 → 那一节代课会失败
    const tpl = await makeTemplate(h.db, '英语', 60);
    await createTrialSlot(h.db, admin, { templateId: tpl.id, teacherId: sub.id, startsAt: at('2027-03-10', '16:00') }, now);

    const res = await applyTeacherLeave(h.db, admin, { teacherId: teacher.id, from: '2027-03-01', to: '2027-03-14', action: 'substitute', substituteTeacherId: sub.id }, now);
    expect(res.map((r) => [r.date, r.ok])).toEqual([
      ['2027-03-03', true],
      ['2027-03-10', false],
    ]);
    expect(res[1].message).toContain('试听');

    const cancel = await applyTeacherLeave(h.db, admin, { teacherId: teacher.id, from: '2027-03-15', to: '2027-03-21', action: 'cancel', reason: '病假' }, now);
    expect(cancel.every((r) => r.ok)).toBe(true);
    const after = await listSessions(h.db, admin, { from: '2027-03-15', to: '2027-03-21' });
    expect(after.find((s) => s.classId === cls.id)!.status).toBe('cancelled');
    expect(after.find((s) => s.classId === otherCls.id)!.status).toBe('scheduled');

    await expectCode(applyTeacherLeave(h.db, admin, { teacherId: teacher.id, from: '2027-03-01', to: '2027-03-07', action: 'substitute' }, now), 'VALIDATION');
  });
});
