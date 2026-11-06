import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '@/db/client';
import { enrollments } from '@/db/schema';
import { listStudents } from '@/server/services/students';
import { at, createTestDb, expectCode, makeClass, makeEnrollment, makeStudent, makeUser, TUESDAY } from './helpers';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

const now = at(TUESDAY, '09:00');

describe('学生列表分页', () => {
  it('分页、总数、越界页码取最后一页；"我的"只含自己负责的学生', async () => {
    const admin = await makeUser(h.db, 'admin');
    const other = await makeUser(h.db, 'admin');
    for (let i = 0; i < 25; i++) await makeStudent(h.db, admin, { name: `分页${String(i).padStart(2, '0')}` });
    await makeStudent(h.db, other, { name: '分页别人' });

    const p1 = await listStudents(h.db, admin, { scope: 'mine', q: '分页', pageSize: 10 }, now);
    expect(p1).toMatchObject({ total: 25, page: 1, pageSize: 10, pages: 3 });
    expect(p1.items.map((s) => s.name)).toEqual(Array.from({ length: 10 }, (_, i) => `分页${String(i).padStart(2, '0')}`));

    const p3 = await listStudents(h.db, admin, { scope: 'mine', q: '分页', pageSize: 10, page: 3 }, now);
    expect(p3.items).toHaveLength(5);
    const beyond = await listStudents(h.db, admin, { scope: 'mine', q: '分页', pageSize: 10, page: 99 }, now);
    expect(beyond.page).toBe(3);

    const all = await listStudents(h.db, admin, { scope: 'all', q: '分页', pageSize: 50 }, now);
    expect(all.total).toBe(26);
    expect(all.items.find((s) => s.name === '分页别人')!.canEdit).toBe(false);
    // 不支持的每页条数回退到 20
    expect((await listStudents(h.db, admin, { scope: 'mine', q: '分页', pageSize: 7 }, now)).pageSize).toBe(20);
  });

  it('每行带上在读班级（已退班的不显示）；搜索里的 % 不会匹配所有人', async () => {
    const admin = await makeUser(h.db, 'admin');
    const t1 = await makeUser(h.db, 'teacher');
    const t2 = await makeUser(h.db, 'teacher');
    const a = await makeClass(h.db, { teacherId: t1.id, weekday: 2, start: '16:00', end: '17:00', name: '在读A' });
    const b = await makeClass(h.db, { teacherId: t2.id, weekday: 4, start: '16:00', end: '17:00', name: '已退B' });
    const st = await makeStudent(h.db, admin, { name: '多班学生' });
    await makeEnrollment(h.db, st.id, a.id, admin.id, '2026-10-01');
    await h.db.insert(enrollments).values({ studentId: st.id, classId: b.id, startDate: '2026-09-01', endDate: '2026-10-31', createdBy: admin.id });

    const res = await listStudents(h.db, admin, { scope: 'mine', q: '多班' }, now);
    expect(res.items[0].classes.map((c) => [c.name, c.weekday, c.startTime])).toEqual([['在读A', 2, '16:00']]);

    expect((await listStudents(h.db, admin, { scope: 'all', q: '%' }, now)).total).toBe(0);
    const teacher = await makeUser(h.db, 'teacher');
    await expectCode(listStudents(h.db, teacher, { scope: 'all' }, now), 'FORBIDDEN');
  });
});
