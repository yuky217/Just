import { Lunar, LunarYear, Solar } from 'lunar-javascript';

import type { CalendarKind } from './container';

/**
 * 农历 / 节气 的解析与换算（第一批：纪念日用）。
 *
 * 库选 `lunar-javascript`（用户拍板：节气不用自己算）。它纯 JS，
 * native / web / vitest 三条路都能直接 import，不用桥接层。
 *
 * 农历月份编码：闰月用**负数**月（闰六月 = -6）。
 * 某年没有对应闰月时，`Lunar.fromYmd(year, negativeMonth, day)` 会抛错 ——
 * 这正是"闰月边缘"要测的（见 `resolveLunarToGregorian` 与 `nextLunarGregorian`）。
 */

/** 24 节气（按节气顺序）；只要这 24 个中文名，英文别名/重复键一律不认 */
export const SOLAR_TERMS = [
  '立春',
  '雨水',
  '惊蛰',
  '春分',
  '清明',
  '谷雨',
  '立夏',
  '小满',
  '芒种',
  '夏至',
  '小暑',
  '大暑',
  '立秋',
  '处暑',
  '白露',
  '秋分',
  '寒露',
  '霜降',
  '立冬',
  '小雪',
  '大雪',
  '冬至',
  '小寒',
  '大寒',
] as const;
export type SolarTerm = (typeof SOLAR_TERMS)[number];

export interface LunarMd {
  /** 是否闰月 */
  leap: boolean;
  /** 月份 1..12 */
  month: number;
  /** 日 1..30 */
  day: number;
}

/* ------------------------------------------------------------------ */
/* 存储串编解码                                                          */
/* ------------------------------------------------------------------ */

/** 闰八月初五 → 'leap8-5'，八月十五 → '8-15' */
export function formatLunarMd(md: LunarMd): string {
  return `${md.leap ? 'leap' : ''}${md.month}-${md.day}`;
}

export function parseLunarMd(raw: string | null | undefined): LunarMd | null {
  if (!raw) return null;
  const leap = raw.startsWith('leap');
  const match = /^(?:leap)?(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  return { leap, month, day };
}

/* ------------------------------------------------------------------ */
/* 单年换算（严格）                                                      */
/* ------------------------------------------------------------------ */

/**
 * 把"某年某农历日"换算成公历。
 *
 * 严格单年语义：某年**没有对应闰月**时（比如 2026 没有闰二月），
 * 直接抛错 —— 调用方想要"往前找下一个有闰月的年份"请用 `nextLunarGregorian`。
 * 该农历月没有那一天（小月 29 天却被要求 30）也会抛错，同样由调用方兜底。
 */
export function resolveLunarToGregorian(
  leap: boolean,
  month: number,
  day: number,
  year: number,
): string {
  if (leap && LunarYear.fromYear(year).getLeapMonth() !== month) {
    throw new Error(`year ${year} has no leap month ${month}`);
  }
  return Lunar.fromYmd(year, leap ? -month : month, day).getSolar().toYmd();
}

/* ------------------------------------------------------------------ */
/* 往前找下一个有效年份（闰月边缘）                                        */
/* ------------------------------------------------------------------ */

/**
 * 从 `fromYear` 起往后找第一个"存在该农历日"的年份，返回那年的公历日期。
 *
 * 专为"下一次闰X"服务：比如 2026 没有闰二月，会一路扫到 2042（下一个闰二月年）。
 * 农历 19 年 7 闰，所以默认只扫 19 年；还找不到就抛错（理论上到不了这步）。
 * 该月某年没有那一天（如 29 天月被要求 30）就跳到下一年继续试。
 */
export function nextLunarGregorian(
  leap: boolean,
  month: number,
  day: number,
  fromYear: number,
  maxAhead = 19,
): string {
  for (let y = fromYear; y <= fromYear + maxAhead; y++) {
    if (leap && LunarYear.fromYear(y).getLeapMonth() !== month) continue;
    try {
      return Lunar.fromYmd(y, leap ? -month : month, day).getSolar().toYmd();
    } catch {
      // 该农历月没有这一天（29 天月却要 30）→ 试下一年
      continue;
    }
  }
  throw new Error(`no lunar date leap=${leap} ${month}-${day} within ${maxAhead} years from ${fromYear}`);
}

/* ------------------------------------------------------------------ */
/* 节气                                                                  */
/* ------------------------------------------------------------------ */

/** 节气在某年的公历日期（节气每年都过，不会有"没有"的情况） */
export function resolveTermToGregorian(term: string, year: number): string {
  const table = Solar.fromYmd(year, 1, 1).getLunar().getJieQiTable();
  const date = table[term];
  if (!date) throw new Error(`unknown solar term: ${term}`);
  return date.toYmd();
}

/* ------------------------------------------------------------------ */
/* 中文标签                                                              */
/* ------------------------------------------------------------------ */

const MONTH_LABELS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
];

const DAY_ONES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十'];
// 注意：下标 0 对应"十一"（day-11），不是"十"；"十"单独由 dayToChinese 的 1..10 分支覆盖
const DAY_TENS = [
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
];

export function monthToChinese(month: number): string {
  return MONTH_LABELS[month - 1] ?? String(month);
}

export function dayToChinese(day: number): string {
  if (day >= 1 && day <= 10) return DAY_ONES[day - 1];
  if (day >= 11 && day <= 30) return DAY_TENS[day - 11];
  return String(day);
}

/** 农历月日的中文标签：闰八月初五 / 八月十五 */
export function lunarMdToLabel(md: LunarMd): string {
  // 直接用自己维护的映射拼，别走 Lunar.fromYmd —— 那样遇到闰年没有的闰月会抛错
  // monthToChinese 已经带"月"（"八月"），所以这里不再补"月"
  const month = `${md.leap ? '闰' : ''}${monthToChinese(md.month)}`;
  return `${month}${dayToChinese(md.day)}`;
}

/**
 * 纪念日横在界面上的那句话（列表、详情、日历都读这一个口径）：
 * - 公历：YYYY-MM-DD（沿用旧行为）
 * - 农历：中文月日（八月十五）
 * - 节气：节气名本身（清明）
 */
export function markCalendarLabel(
  calendar: CalendarKind | undefined,
  lunarMd: string | null | undefined,
  term: string | null | undefined,
  solarDate: string,
): string {
  if (calendar === 'lunar') {
    const md = parseLunarMd(lunarMd);
    return md ? lunarMdToLabel(md) : solarDate;
  }
  if (calendar === 'term') return term ?? solarDate;
  return solarDate;
}

/* ------------------------------------------------------------------ */
/* 文本解析辅助（"闰八月初五""八月十五" 这类口语）                          */
/* ------------------------------------------------------------------ */

const MONTH_CN: Record<string, number> = {
  正: 1,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
  冬: 11,
  腊: 12,
};

const DAY_CN: Record<string, number> = {
  初一: 1,
  初二: 2,
  初三: 3,
  初四: 4,
  初五: 5,
  初六: 6,
  初七: 7,
  初八: 8,
  初九: 9,
  初十: 10,
  十一: 11,
  十二: 12,
  十三: 13,
  十四: 14,
  十五: 15,
  十六: 16,
  十七: 17,
  十八: 18,
  十九: 19,
  二十: 20,
  廿一: 21,
  廿二: 22,
  廿三: 23,
  廿四: 24,
  廿五: 25,
  廿六: 26,
  廿七: 27,
  廿八: 28,
  廿九: 29,
  二十一: 21,
  二十二: 22,
  二十三: 23,
  二十四: 24,
  二十五: 25,
  二十六: 26,
  二十七: 27,
  二十八: 28,
  二十九: 29,
  三十: 30,
};

/**
 * 把口语化的农历串解析成结构。只做"尽力而为"的辅助：
 * 认不出就返回 null，让界面回到滚轮选择，不去猜。
 *
 * 支持：闰八月初五 / 八月十五 / 正月初一 / 腊月三十 / 冬月二十 / 五月（只给月，默认初一）。
 */
export function parseLunarText(text: string): LunarMd | null {
  const t = text.trim().replace(/\s+/g, '');
  // "月"字在中间（如"八月初五"），不是结尾；只要串里含"月"就说明说的是农历月
  if (!t.includes('月')) return null;

  const leap = t.startsWith('闰');
  // 去掉 闰 前缀；再用 endsWith('月') 去掉末尾的"月"（不能用 slice(-1)，否则会把日的最后一位也切掉）
  let body = t.slice(leap ? 1 : 0);
  if (body.endsWith('月')) body = body.slice(0, -1);

  const monthKeys = Object.keys(MONTH_CN).sort((a, b) => b.length - a.length);
  let month: number | null = null;
  let monthPart = '';
  for (const key of monthKeys) {
    if (body.startsWith(key)) {
      month = MONTH_CN[key];
      monthPart = key;
      break;
    }
  }
  if (month === null) return null;

  let dayPart = body.slice(monthPart.length);
  // 月份与日之间一定有"月"字（"八月初五"），去掉它再去找日
  if (dayPart.startsWith('月')) dayPart = dayPart.slice(1);
  if (!dayPart) return { leap, month, day: 1 }; // 只给了月份，默认初一

  const day = DAY_CN[dayPart];
  if (day === undefined) return null;
  return { leap, month, day };
}
