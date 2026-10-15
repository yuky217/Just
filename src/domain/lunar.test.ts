import { describe, expect, it } from 'vitest';

import {
  formatLunarMd,
  lunarMdToLabel,
  markCalendarLabel,
  nextLunarGregorian,
  parseLunarMd,
  parseLunarText,
  resolveLunarToGregorian,
  resolveTermToGregorian,
} from './lunar';

/**
 * 这些"锚点"是用真·农历库算出来的硬值，不是我手拍的。
 * 节气每年会前后差一两天（2025 清明=4/4、2026=4/5、2027=4/5），
 * 一旦库升级或算法变动，这些值就是第一道警报。
 */
describe('lunar：换算锚点', () => {
  it('2026 清明 = 4/5（节气每年差一两天，锚点防这个）', () => {
    expect(resolveTermToGregorian('清明', 2026)).toBe('2026-04-05');
  });

  it('2025 清明 = 4/4、2027 清明 = 4/5（验证"每年差一两天"）', () => {
    expect(resolveTermToGregorian('清明', 2025)).toBe('2025-04-04');
    expect(resolveTermToGregorian('清明', 2027)).toBe('2027-04-05');
  });

  it('2026 八月十五 = 9/25', () => {
    expect(resolveLunarToGregorian(false, 8, 15, 2026)).toBe('2026-09-25');
  });

  it('2023 闰二月初一 = 2023-03-22（闰月用负数月编码）', () => {
    expect(resolveLunarToGregorian(true, 2, 1, 2023)).toBe('2023-03-22');
  });

  it('2025 闰六月初一 = 2025-07-25', () => {
    expect(resolveLunarToGregorian(true, 6, 1, 2025)).toBe('2025-07-25');
  });
});

describe('lunar：闰月边缘', () => {
  it('某年没有对应闰月时，单年换算直接报错（不静默给错值）', () => {
    // 2026 没有闰二月 → 必须抛，而不是吐出一个错的公历日期
    expect(() => resolveLunarToGregorian(true, 2, 1, 2026)).toThrow();
  });

  it('往前找下一个有闰月的年份（2026 闰二月 → 2042-03-22）', () => {
    // 拍板：没有就"往下一年找"。2026 之后下一个闰二月是 2042 年。
    expect(nextLunarGregorian(true, 2, 1, 2026)).toBe('2042-03-22');
  });

  it('不存在的闰月年份范围内找不到时报错', () => {
    // 把扫描窗口压到极小，确保"找不到"路径也能被覆盖
    expect(() => nextLunarGregorian(true, 2, 1, 2026, 1)).toThrow();
  });
});

describe('lunar：编解码与标签', () => {
  it('formatLunarMd / parseLunarMd 互为逆', () => {
    expect(formatLunarMd({ leap: false, month: 8, day: 15 })).toBe('8-15');
    expect(formatLunarMd({ leap: true, month: 2, day: 5 })).toBe('leap2-5');
    expect(parseLunarMd('8-15')).toEqual({ leap: false, month: 8, day: 15 });
    expect(parseLunarMd('leap2-5')).toEqual({ leap: true, month: 2, day: 5 });
  });

  it('lunarMdToLabel', () => {
    expect(lunarMdToLabel({ leap: false, month: 8, day: 15 })).toBe('八月十五');
    expect(lunarMdToLabel({ leap: true, month: 2, day: 1 })).toBe('闰二月初一');
  });

  it('markCalendarLabel：按历法返回那句话', () => {
    expect(markCalendarLabel('solar', null, null, '2026-04-05')).toBe('2026-04-05');
    expect(markCalendarLabel('lunar', '8-15', null, '2026-09-25')).toBe('八月十五');
    expect(markCalendarLabel('term', null, '清明', '2026-04-05')).toBe('清明');
  });
});

describe('lunar：文本解析辅助', () => {
  it('口语串解析', () => {
    expect(parseLunarText('闰八月初五')).toEqual({ leap: true, month: 8, day: 5 });
    expect(parseLunarText('八月十五')).toEqual({ leap: false, month: 8, day: 15 });
    expect(parseLunarText('正月初一')).toEqual({ leap: false, month: 1, day: 1 });
    expect(parseLunarText('腊月三十')).toEqual({ leap: false, month: 12, day: 30 });
    expect(parseLunarText('冬月二十')).toEqual({ leap: false, month: 11, day: 20 });
    // 只给了月份 → 默认初一
    expect(parseLunarText('五月')).toEqual({ leap: false, month: 5, day: 1 });
  });

  it('认不出的串返回 null', () => {
    expect(parseLunarText('hello')).toBeNull();
    expect(parseLunarText('八月三十一')).toBeNull(); // 没有三十一天
    expect(parseLunarText('闰十三月')).toBeNull();
  });
});
