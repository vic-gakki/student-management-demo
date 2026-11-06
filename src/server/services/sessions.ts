// 课次按需生成。
// 班级是"每周几、几点"的规则，课次是具体某一天的那一节。任何按日期查课次的地方，先调用 ensureSessions 把这段时间补齐，
// 这样不依赖定时任务，也不会出现"几周之后今日课程是空的"。
import { and, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { classSessions, classes } from '@/db/schema';
import { addDays, isoWeekday, melbourneDateTime } from '@/lib/time';

/**
 * 把 [from, to]（墨尔本日期，含两端）内所有班级的课次补齐。
 * 幂等：已有的课次（包括已停课、已指定代课的）不会被覆盖；并发调用由唯一约束 (class_id, starts_at) 兜底。
 * 每节课的 UTC 时间按当天的墨尔本时区换算，跨夏令时后本地时刻不变。
 */
export async function ensureSessions(db: Db, from: string, to: string): Promise<number> {
  if (to < from) return 0;
  const cls = await db
    .select()
    .from(classes)
    .where(and(lte(classes.startsOn, to), or(isNull(classes.endsOn), gte(classes.endsOn, from))));
  const values: (typeof classSessions.$inferInsert)[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const c of cls) {
      if (c.weekday !== wd || c.startsOn > d || (c.endsOn && c.endsOn < d)) continue;
      values.push({ classId: c.id, startsAt: melbourneDateTime(d, c.startTime), endsAt: melbourneDateTime(d, c.endTime) });
    }
  }
  if (values.length === 0) return 0;
  const inserted = await db.insert(classSessions).values(values).onConflictDoNothing().returning({ id: classSessions.id });
  return inserted.length;
}
