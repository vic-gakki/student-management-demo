import { describe, expect, it } from 'vitest';
import { isoWeekday, melbourneDate, melbourneDateTime, melbourneTime, nextWeekdayOnOrAfter, timesOverlap } from '@/lib/time';

describe('墨尔本时区', () => {
  it('跨夏令时，每周二 16:00 仍然是本地 16:00（UTC 时间点不同）', () => {
    // 墨尔本 2026-10-04 进入夏令时（UTC+10 → UTC+11）
    const before = melbourneDateTime('2026-09-29', '16:00');
    const after = melbourneDateTime('2026-10-06', '16:00');
    expect(before.toISOString()).toBe('2026-09-29T06:00:00.000Z');
    expect(after.toISOString()).toBe('2026-10-06T05:00:00.000Z');
    expect(melbourneTime(before)).toBe('16:00');
    expect(melbourneTime(after)).toBe('16:00');
  });

  it('"今天"按墨尔本计算', () => {
    // UTC 11-09 20:00 = 墨尔本 11-10 07:00
    expect(melbourneDate(new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
  });

  it('星期与日期工具', () => {
    expect(isoWeekday('2026-11-10')).toBe(2);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(nextWeekdayOnOrAfter('2026-11-10', 2)).toBe('2026-11-10');
    expect(nextWeekdayOnOrAfter('2026-11-10', 1)).toBe('2026-11-16');
    expect(timesOverlap('16:00', '17:00', '17:00', '18:00')).toBe(false);
    expect(timesOverlap('16:00:00', '17:00:00', '16:30', '17:30')).toBe(true);
  });
});
