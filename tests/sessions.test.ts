import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { classSessions } from '@/db/schema';
import { ensureSessions } from '@/server/services/sessions';
import { getTeacherDay, getTeacherWeek } from '@/server/services/attendance';
import { createTestDb, makeClass, makeUser } from './helpers';
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
