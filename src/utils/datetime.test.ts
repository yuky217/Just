import { describe, expect, it } from 'vitest';

import { formatMinutes, parseDayKey } from './datetime';

/**
 * `formatMinutes`（2026-10-12 收进 utils）：日视图的块和改期确认条共用它。
 *
 * 要锁的是**越界怎么显示** —— 23:45 那半小时的块会算出 1455 分钟，
 * 显示成 "24:15" 不像时间，取模绕回 "00:15" 更糟（看着比开始时间还早）。
 * 所以钳到当天最后一分钟。
 */
describe('formatMinutes', () => {
  it.each([
    [0, '00:00'],
    [5 * 60, '05:00'],
    [9 * 60, '09:00'],
    [14 * 60 + 30, '14:30'],
    [23 * 60 + 59, '23:59'],
  ] as const)('%i 分钟 → %s', (minutes, label) => {
    expect(formatMinutes(minutes)).toBe(label);
  });

  it('超过 24 小时：钳到 23:59，不显示 24:15、也不绕回 00:15', () => {
    expect(formatMinutes(24 * 60 + 15)).toBe('23:59');
    expect(formatMinutes(24 * 60)).toBe('23:59');
  });

  it('负数：钳到 00:00', () => {
    expect(formatMinutes(-30)).toBe('00:00');
  });

  it('带小数：四舍五入（拖动吸附后可能带小数）', () => {
    expect(formatMinutes(14 * 60 + 29.6)).toBe('14:30');
  });
});

describe('parseDayKey', () => {
  it('按本地时区解析，不按 UTC（"2026-10-06" 不能变成前一天早上）', () => {
    const d = parseDayKey('2026-10-06');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(6);
    expect(d!.getHours()).toBe(0);
  });

  it('不是日期的字符串 → null', () => {
    expect(parseDayKey('明天')).toBeNull();
    expect(parseDayKey('')).toBeNull();
    expect(parseDayKey(null)).toBeNull();
  });
});
