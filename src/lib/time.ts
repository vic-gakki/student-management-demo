// 业务时间统一按墨尔本时区处理。
// 关键点：周期班级存"墨尔本本地的星期几 + 时刻"，具体课次在生成时再换算成 UTC 时间点，
// 这样跨夏令时后"每周二 16:00"仍然是 16:00。
import { TZDate } from '@date-fns/tz';

export const TZ = 'Australia/Melbourne';

const pad = (n: number) => String(n).padStart(2, '0');

/** 墨尔本本地日期 + 时刻 → 绝对时间点 */
export function melbourneDateTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, TZ).getTime());
}

/** 绝对时间点 → 墨尔本本地日期 'YYYY-MM-DD' */
export function melbourneDate(at: Date): string {
  const t = new TZDate(at.getTime(), TZ);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 绝对时间点 → 墨尔本本地时刻 'HH:MM' */
export function melbourneTime(at: Date): string {
  const t = new TZDate(at.getTime(), TZ);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** ISO 星期几：1=周一 … 7=周日 */
export function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 从 fromDate（含）开始，下一个指定星期几的日期 */
export function nextWeekdayOnOrAfter(fromDate: string, weekday: number): string {
  const diff = (weekday - isoWeekday(fromDate) + 7) % 7;
  return addDays(fromDate, diff);
}

/** 本周一（墨尔本） */
export function weekStart(dateStr: string): string {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

/** 'HH:MM' 或 'HH:MM:SS' → 'HH:MM:SS'，便于直接比较字符串 */
export function normTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t.slice(0, 8);
}

export function shortTime(t: string): string {
  return t.slice(0, 5);
}

/** 两个同一天内的时间段是否重叠（首尾相接不算重叠） */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return normTime(aStart) < normTime(bEnd) && normTime(bStart) < normTime(aEnd);
}

/** 两个日期区间是否重叠，end 为 null 表示一直持续 */
export function dateRangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  const aEndOk = aEnd === null || aEnd >= bStart;
  const bEndOk = bEnd === null || bEnd >= aStart;
  return aEndOk && bEndOk;
}

export const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function formatMelbourne(at: Date): string {
  return `${melbourneDate(at)} ${melbourneTime(at)}`;
}
