import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { enrollStudent, endEnrollment } from '@/server/services/enrollment';
import { listClassOptions } from '@/server/services/eligibility';
import { setAvailability } from '@/server/services/students';
import { at, createTestDb, expectCode, makeClass, makeEnrollment, makeStudent, makeUser, TUESDAY } from './helpers';

let h: DbHandle;
const now = at(TUESDAY, '09:00');

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe('规则 1：老师同一时间不能带两个班（数据库 EXCLUDE 约束）', () => {
  it('直接插入重叠的班级会被数据库拒绝', async () => {
    const t = await makeUser(h.db, 'teacher');
    await makeClass(h.db, { teacherId: t.id, weekday: 3, start: '16:00', end: '17:00' });
    await expect(makeClass(h.db, { teacherId: t.id, weekday: 3, start: '16:30', end: '17:30' })).rejects.toThrow();
    // 首尾相接不算冲突，不同星期几也不冲突
    await makeClass(h.db, { teacherId: t.id, weekday: 3, start: '17:00', end: '18:00' });
    await makeClass(h.db, { teacherId: t.id, weekday: 4, start: '16:00', end: '17:00' });
  });
});

describe('排班规则', () => {
  it('规则 2：学生在读班级之间时间不能重叠；转班时排除旧班', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const math = await makeClass(h.db, { teacherId: t1.id, weekday: 2, start: '16:00', end: '17:00' });
    const eng = await makeClass(h.db, { teacherId: t2.id, weekday: 2, start: '16:30', end: '17:30', subject: '英语' });
    const st = await makeStudent(h.db, admin);
    await enrollStudent(h.db, admin, { studentId: st.id, classId: math.id }, now);

    const err = await expectCode(enrollStudent(h.db, admin, { studentId: st.id, classId: eng.id }, now), 'SCHEDULE_CONFLICT');
    expect((err as Error).message).toContain('时间冲突');

    // 从数学班转到同一时间的另一个数学班 → 允许
    const t3 = await makeUser(h.db, 'teacher');
    const math2 = await makeClass(h.db, { teacherId: t3.id, weekday: 2, start: '16:00', end: '17:00', name: '数学平行班' });
    const res = await enrollStudent(h.db, admin, { studentId: st.id, classId: math2.id, transferFromClassId: math.id }, now);
    expect(res.enrollment.classId).toBe(math2.id);
  });

  it('规则 3：班级不能超过人数上限', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 5, start: '16:00', end: '17:00', capacity: 2 });
    for (let i = 0; i < 2; i++) {
      const s = await makeStudent(h.db, admin);
      await enrollStudent(h.db, admin, { studentId: s.id, classId: cls.id }, now);
    }
    const s3 = await makeStudent(h.db, admin);
    await expectCode(enrollStudent(h.db, admin, { studentId: s3.id, classId: cls.id }, now), 'CLASS_FULL');
  });

  it('规则 4：余额为 0 不能排进新班；数据库 CHECK 兜底不允许负余额', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 1, start: '16:00', end: '17:00' });
    const st = await makeStudent(h.db, admin, { hours: 0 });
    await expectCode(enrollStudent(h.db, admin, { studentId: st.id, classId: cls.id }, now), 'INSUFFICIENT_HOURS');
    await expect(
      h.db.execute(sql`UPDATE student_balances SET remaining_hours = -1 WHERE student_id = ${st.id}`),
    ).rejects.toThrow();
  });

  it('规则 6：admin 只能修改自己负责的学生', async () => {
    const owner = await makeUser(h.db, 'admin');
    const other = await makeUser(h.db, 'admin');
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 1, start: '18:00', end: '19:00' });
    const st = await makeStudent(h.db, owner);
    await expectCode(enrollStudent(h.db, other, { studentId: st.id, classId: cls.id }, now), 'FORBIDDEN');
    await expectCode(setAvailability(h.db, other, st.id, []), 'FORBIDDEN');
    // 老师也不能排班
    await expectCode(enrollStudent(h.db, t, { studentId: st.id, classId: cls.id }, now), 'FORBIDDEN');
  });

  it('规则 15：还没购买课时包（咨询/试听状态）的学生不能排进正式班', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 1, start: '19:00', end: '20:00' });
    const lead = await makeStudent(h.db, admin, { status: 'lead', hours: 0 });
    await expectCode(enrollStudent(h.db, admin, { studentId: lead.id, classId: cls.id }, now), 'NOT_ENROLLED');
  });

  it('开始日期不能早于今天；同一个班不能重复报名', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: t.id, weekday: 6, start: '10:00', end: '11:00' });
    const st = await makeStudent(h.db, admin);
    await expectCode(enrollStudent(h.db, admin, { studentId: st.id, classId: cls.id, startDate: '2026-11-01' }, now), 'INVALID_DATE');
    await enrollStudent(h.db, admin, { studentId: st.id, classId: cls.id }, now);
    await expectCode(enrollStudent(h.db, admin, { studentId: st.id, classId: cls.id }, now), 'ALREADY_ENROLLED');
  });

  it('并发：同一学生同时排两个冲突的班，只有一个成功', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const a = await makeClass(h.db, { teacherId: t1.id, weekday: 7, start: '09:00', end: '10:00' });
    const b = await makeClass(h.db, { teacherId: t2.id, weekday: 7, start: '09:30', end: '10:30' });
    const st = await makeStudent(h.db, admin);
    const results = await Promise.allSettled([
      enrollStudent(h.db, admin, { studentId: st.id, classId: a.id }, now),
      enrollStudent(h.db, admin, { studentId: st.id, classId: b.id }, now),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('SCHEDULE_CONFLICT');
  });

  it('候选班级列表标出原因，与提交时的检查一致；可用时间只做提示', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const t3 = await makeUser(h.db, 'teacher');
    const existing = await makeClass(h.db, { teacherId: t1.id, weekday: 2, start: '18:00', end: '19:00', subject: '物理' });
    const conflict = await makeClass(h.db, { teacherId: t2.id, weekday: 2, start: '18:30', end: '19:30', subject: '化学' });
    const free = await makeClass(h.db, { teacherId: t3.id, weekday: 4, start: '18:00', end: '19:00', subject: '化学' });
    const st = await makeStudent(h.db, admin);
    await makeEnrollment(h.db, st.id, existing.id, admin.id);
    await setAvailability(h.db, admin, st.id, [{ weekday: 2, fromTime: '17:00', toTime: '20:00' }]);

    const opts = await listClassOptions(h.db, { studentId: st.id, subject: '化学', today: TUESDAY });
    const c = opts.find((o) => o.classId === conflict.id)!;
    const f = opts.find((o) => o.classId === free.id)!;
    expect(c.ok).toBe(false);
    expect(c.reasons[0].code).toBe('SCHEDULE_CONFLICT');
    expect(f.ok).toBe(true);
    expect(f.warnings.map((w) => w.code)).toContain('OUTSIDE_AVAILABILITY');
    await expectCode(enrollStudent(h.db, admin, { studentId: st.id, classId: conflict.id }, now), 'SCHEDULE_CONFLICT');
    const res = await enrollStudent(h.db, admin, { studentId: st.id, classId: free.id }, now);
    expect(res.warnings.map((w) => w.code)).toContain('OUTSIDE_AVAILABILITY');
  });

  it('退班后可以再排同一时间的其他班', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const a = await makeClass(h.db, { teacherId: t1.id, weekday: 3, start: '10:00', end: '11:00' });
    const b = await makeClass(h.db, { teacherId: t2.id, weekday: 3, start: '10:00', end: '11:00' });
    const st = await makeStudent(h.db, admin);
    const e = await makeEnrollment(h.db, st.id, a.id, admin.id, '2026-10-01');
    await endEnrollment(h.db, admin, e.id, '2026-11-09', now);
    const res = await enrollStudent(h.db, admin, { studentId: st.id, classId: b.id }, now);
    expect(res.enrollment.startDate).toBe('2026-11-11');
  });
});
