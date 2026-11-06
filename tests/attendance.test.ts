import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { attendance, followUpTasks, lessonLedger } from '@/db/schema';
import { getRoster, markAttendance } from '@/server/services/attendance';
import { purchasePackage, refundRemaining } from '@/server/services/ledger';
import {
  at,
  balanceOf,
  createTestDb,
  expectCode,
  expectDbError,
  ledgerSum,
  makeClass,
  makeEnrollment,
  makeSession,
  makeStudent,
  makeUser,
  TUESDAY,
} from './helpers';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

async function setup(hours = 10, owed = 0) {
  const admin = await makeUser(h.db, 'admin');
  const teacher = await makeUser(h.db, 'teacher');
  const cls = await makeClass(h.db, { teacherId: teacher.id, weekday: 2, start: '16:00', end: '17:00' });
  const st = await makeStudent(h.db, admin, { hours, owed });
  await makeEnrollment(h.db, st.id, cls.id, admin.id, '2026-10-06');
  const session = await makeSession(h.db, cls, TUESDAY);
  return { admin, teacher, cls, st, session };
}
const during = at(TUESDAY, '16:10');

describe('点名扣课时', () => {
  it('规则 5：重复提交同样的点名只扣一次课时（幂等）', async () => {
    const { teacher, st, session } = await setup(10);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], during);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], during);
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(9);
    expect(await ledgerSum(h.db, st.id)).toBe(9);
    // 数据库唯一约束兜底：直接插第二条出勤会失败
    await expect(
      h.db.insert(attendance).values({ sessionId: session.id, studentId: st.id, status: 'present', billing: 'charged', markedBy: teacher.id }),
    ).rejects.toThrow();
  });

  it('请假不扣；从出勤改成请假会写补偿流水退回课时，旧流水不改', async () => {
    const { teacher, st, session } = await setup(5);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], during);
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(4);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'excused' }], during);
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(5);
    const rows = await h.db.select().from(lessonLedger).where(eq(lessonLedger.studentId, st.id));
    expect(rows.map((r) => r.reason).sort()).toEqual(['adjustment', 'attendance', 'purchase']);
    expect(await ledgerSum(h.db, st.id)).toBe(5);
  });

  it('无故缺席也扣课时', async () => {
    const { teacher, st, session } = await setup(3);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'absent' }], during);
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(2);
  });

  it('规则 7：老师只能给自己的课点名；有代课时只有代课老师能点', async () => {
    const { teacher, st, cls } = await setup();
    const other = await makeUser(h.db, 'teacher');
    const s1 = await makeSession(h.db, cls, '2026-11-03');
    await expectCode(markAttendance(h.db, other, s1.id, [{ studentId: st.id, status: 'present' }], at('2026-11-03', '16:10')), 'FORBIDDEN');
    const sub = await makeUser(h.db, 'teacher');
    const s2 = await makeSession(h.db, cls, '2026-10-27', { substituteTeacherId: sub.id });
    await expectCode(markAttendance(h.db, teacher, s2.id, [{ studentId: st.id, status: 'present' }], at('2026-10-27', '16:10')), 'FORBIDDEN');
    await markAttendance(h.db, sub, s2.id, [{ studentId: st.id, status: 'present' }], at('2026-10-27', '16:10'));
  });

  it('规则 8：课开始前不能点名；超过 7 天不能再点', async () => {
    const { teacher, st, session } = await setup();
    await expectCode(markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], at(TUESDAY, '15:59')), 'TOO_EARLY');
    await expectCode(markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], at('2026-11-18', '09:00')), 'WINDOW_CLOSED');
  });

  it('不在名单里的学生不能点名（名单由报名日期推导）', async () => {
    const { teacher, admin, session } = await setup();
    const outsider = await makeStudent(h.db, admin);
    await expectCode(markAttendance(h.db, teacher, session.id, [{ studentId: outsider.id, status: 'present' }], during), 'NOT_IN_ROSTER');
  });

  it('名单标记新生（14 天内入班）和课时状态，不暴露余额数字', async () => {
    const { admin, cls, session } = await setup();
    const newbie = await makeStudent(h.db, admin, { hours: 1 });
    await makeEnrollment(h.db, newbie.id, cls.id, admin.id, '2026-11-05');
    const roster = await getRoster(h.db, session.id);
    const n = roster.students.find((s) => s.studentId === newbie.id)!;
    expect(n.isNew).toBe(true);
    expect(n.balanceFlag).toBe('low');
    expect(n).not.toHaveProperty('remainingHours');
  });
});

describe('欠课与续费（规则 9、10）', () => {
  it('余额为 0：照常记出勤、标记欠课、给负责 admin 生成待办；欠 2 节后拒绝', async () => {
    const { admin, teacher, cls, st, session } = await setup(0);
    const r = await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], during);
    expect(r.results[0].billing).toBe('owed');
    expect((await balanceOf(h.db, st.id)).owedHours).toBe(1);
    const tasks = await h.db
      .select()
      .from(followUpTasks)
      .where(and(eq(followUpTasks.studentId, st.id), eq(followUpTasks.type, 'owed_hours'), isNull(followUpTasks.doneAt)));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].adminId).toBe(admin.id);

    const s2 = await makeSession(h.db, cls, '2026-11-03');
    await markAttendance(h.db, teacher, s2.id, [{ studentId: st.id, status: 'present' }], at('2026-11-03', '16:10'));
    const s3 = await makeSession(h.db, cls, '2026-10-27');
    await expectCode(markAttendance(h.db, teacher, s3.id, [{ studentId: st.id, status: 'present' }], at('2026-10-27', '16:10')), 'OWED_LIMIT');
    // 一次提交整体失败，不会留下半条出勤
    expect(await h.db.select().from(attendance).where(eq(attendance.sessionId, s3.id))).toHaveLength(0);
    // 数据库兜底
    await expect(h.db.execute(sql`UPDATE student_balances SET owed_hours = 3 WHERE student_id = ${st.id}`)).rejects.toThrow();
  });

  it('续费时先补扣欠课，余额与流水一致，欠课待办关闭', async () => {
    const { admin, teacher, st, session } = await setup(0);
    await markAttendance(h.db, teacher, session.id, [{ studentId: st.id, status: 'present' }], during);
    const res = await purchasePackage(h.db, admin, { studentId: st.id, hours: 10, priceCents: 50000, paymentMethod: '转账', paymentRef: 'PAY-001' });
    expect(res.settledOwed).toBe(1);
    const bal = await balanceOf(h.db, st.id);
    expect(bal.remainingHours).toBe(9);
    expect(bal.owedHours).toBe(0);
    expect(await ledgerSum(h.db, st.id)).toBe(9);
    const [a] = await h.db.select().from(attendance).where(eq(attendance.sessionId, session.id));
    expect(a.billing).toBe('settled');
    const open = await h.db
      .select()
      .from(followUpTasks)
      .where(and(eq(followUpTasks.studentId, st.id), eq(followUpTasks.type, 'owed_hours'), isNull(followUpTasks.doneAt)));
    expect(open).toHaveLength(0);
  });

  it('规则 10：同一笔付款不能录两次；非负责人不能录入', async () => {
    const { admin, st } = await setup(2);
    await purchasePackage(h.db, admin, { studentId: st.id, hours: 5, priceCents: 1, paymentMethod: '刷卡', paymentRef: 'PAY-DUP' });
    await expectCode(
      purchasePackage(h.db, admin, { studentId: st.id, hours: 5, priceCents: 1, paymentMethod: '刷卡', paymentRef: 'PAY-DUP' }),
      'DUPLICATE_PAYMENT',
    );
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(7);
    const other = await makeUser(h.db, 'admin');
    await expectCode(
      purchasePackage(h.db, other, { studentId: st.id, hours: 5, priceCents: 1, paymentMethod: '刷卡', paymentRef: 'PAY-X' }),
      'FORBIDDEN',
    );
    await expectCode(
      purchasePackage(h.db, admin, { studentId: st.id, hours: 0, priceCents: 1, paymentMethod: '刷卡', paymentRef: 'PAY-Y' }),
      'VALIDATION',
    );
  });

  it('首次购买把咨询/试听学生改为在读', async () => {
    const admin = await makeUser(h.db, 'admin');
    const lead = await makeStudent(h.db, admin, { status: 'trial', hours: 0 });
    await purchasePackage(h.db, admin, { studentId: lead.id, hours: 20, priceCents: 100000, paymentMethod: '转账', paymentRef: 'PAY-NEW' });
    const [row] = (await h.db.execute(sql`SELECT status FROM students WHERE id = ${lead.id}`)).rows as { status: string }[];
    expect(row.status).toBe('enrolled');
  });
});

describe('退费与流水审计', () => {
  it('退费 = 剩余课时 × 单价（从最近的课时包往前算），余额清零', async () => {
    const admin = await makeUser(h.db, 'admin');
    const st = await makeStudent(h.db, admin, { hours: 0 });
    await purchasePackage(h.db, admin, { studentId: st.id, hours: 10, priceCents: 40000, paymentMethod: '转账', paymentRef: 'R-1' }); // 40/节
    await purchasePackage(h.db, admin, { studentId: st.id, hours: 5, priceCents: 25000, paymentMethod: '转账', paymentRef: 'R-2' }); // 50/节
    const res = await refundRemaining(h.db, admin, { studentId: st.id, reason: '搬家' });
    // 15 节：最近的 5 节 × 50 + 10 节 × 40
    expect(res).toEqual({ refundedHours: 15, amountCents: 25000 + 40000 });
    expect((await balanceOf(h.db, st.id)).remainingHours).toBe(0);
    expect(await ledgerSum(h.db, st.id)).toBe(0);
    await expectCode(refundRemaining(h.db, admin, { studentId: st.id, reason: '再退' }), 'NOTHING_TO_REFUND');
  });

  it('规则 11：课时流水只追加，数据库拒绝修改和删除', async () => {
    const admin = await makeUser(h.db, 'admin');
    const st = await makeStudent(h.db, admin, { hours: 3 });
    await expectDbError(h.db.execute(sql`UPDATE lesson_ledger SET delta = 100 WHERE student_id = ${st.id}`), /append-only/);
    await expectDbError(h.db.execute(sql`DELETE FROM lesson_ledger WHERE student_id = ${st.id}`), /append-only/);
  });
});
