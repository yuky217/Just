import { differenceInCalendarDays, format, startOfDay } from 'date-fns';

import { parseDayKey, toDayKey } from '@/utils/datetime';

import { buildSpanTime } from './schedule-presets';
import type { TaskTime } from './task';

/**
 * 能力「排期」的**业务口径**（2026-10-13 接上）。
 *
 * 为什么口径要先在这里定死（README 八、下一步第 4 条）：模型给出的"建议"
 * 必须有一份**可对的地方** —— 它对到的是"候选任务的 id"和"未来这一周里的
 * 一个合法时段"。没有这层，模型说的"周三下午"落不了库，界面也无从校验。
 *
 * 三条边界：
 * 1. **模型只建议，不落库。** 净化后的 plans 只是"建议"，用户必须在面板上
 *    过一遍（勾/取消）才落库。与「拆解」同一原则。
 * 2. **不合格就丢那一条，不修不猜**（见 `sanitizePlans` 的四道闸）——
 *    一条被排错时间的任务，用户当场看不出来是错的。
 * 3. **只在未来一周里排。** 更远的安排不如让用户自己定；把"下周之后也行"
 *    交给模型，只会得到一堆拍脑袋的日子。
 */

/** 一条"待排"的候选任务 —— 既是喂给模型的最小信息，也是建议落地的**白名单** */
export interface ScheduleCandidate {
  id: string;
  title: string;
  /** 预计时长（分钟）；null = 没说，让模型自己估一个 */
  durationMinutes?: number | null;
  /** 截止（人类可读，如「10月20日」）；null = 没有 */
  dueLabel?: string | null;
  /** 优先级标签（如「高」）；null = 普通 */
  priorityLabel?: string | null;
}

/** 一条建议安排：把某条候选放到某天的某个时段 */
export interface SchedulePlan {
  id: string;
  /** yyyy-MM-dd */
  dayKey: string;
  /** 起止（当天分钟数，0–1440） */
  startMinutes: number;
  endMinutes: number;
}

/** 只在"未来一周"里排 —— 再远不如让用户自己定 */
export const SCHEDULE_WINDOW_DAYS = 7;
/** 排期窗口的最远档（再远就超出"这一阵"的语义了） */
export const SCHEDULE_WINDOW_MAX_DAYS = 14;
/** 窗口可选档位。默认就是第一档之外的 7 天（"有默认值，也可以不调"） */
export const SCHEDULE_WINDOW_OPTIONS = [3, 7, 14] as const;
/** 一段安排的时长下限 / 上限（分钟）：太短没意义，太长不像"排一件事" */
export const SCHEDULE_MIN_MINUTES = 15;
export const SCHEDULE_MAX_MINUTES = 240;
/** 一次最多采纳几条建议（面板一屏看完） */
export const SCHEDULE_PLANS_MAX = 10;

/** 一周七天的中文名，`Date.getDay()` 的下标 */
export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/*
  ★ 排期的两条"可调条件"（2026-10-15）。

  原来窗口固定 7 天、时段固定 8:00–22:00 写死在提示词里 —— 那等于替用户
  定了"接下来一周、白天随便什么时候"。但真有人只想排未来 3 天、只想排在晚上。

  这两项是**条件不是开关**：默认值就在那儿（7 天 · 全天），不想调的人
  一次都不用碰它；调过一次就记住，下次还是这个（存 settings）。
*/
/** 一天里允许排的一个时段（当天分钟数） */
export interface ScheduleSlot {
  startMinutes: number;
  endMinutes: number;
}

export interface ScheduleDayPart {
  id: string;
  label: string;
  slots: readonly ScheduleSlot[];
}

/**
 * 时段四档。`all` 那档的 8:00–22:00 就是原来写死的那两个数 ——
 * 默认值不动，只是它现在可以被换掉。
 *
 * ⚠️ 它的**标签写「白天」不写「全天」**：这一档其实不排 22:00 之后，
 * 写"全天"等于承诺了一件做不到的事（界面不许替自己吹牛）。
 * id 仍叫 `all`，因为它就是"不限时段"那一档。
 */
export const SCHEDULE_DAY_PARTS: readonly ScheduleDayPart[] = [
  { id: 'all', label: '白天', slots: [{ startMinutes: 8 * 60, endMinutes: 22 * 60 }] },
  { id: 'morning', label: '上午', slots: [{ startMinutes: 8 * 60, endMinutes: 12 * 60 }] },
  { id: 'afternoon', label: '下午', slots: [{ startMinutes: 12 * 60, endMinutes: 18 * 60 }] },
  { id: 'evening', label: '晚上', slots: [{ startMinutes: 18 * 60, endMinutes: 22 * 60 }] },
];

/** 一次排期的范围条件：往后排几天 + 每天排在哪个时段 */
export interface ScheduleScope {
  windowDays: number;
  dayPartId: string;
}

export const DEFAULT_SCHEDULE_SCOPE: ScheduleScope = {
  windowDays: SCHEDULE_WINDOW_DAYS,
  dayPartId: 'all',
};

/** 把任意来源的条件洗成能用的（设置里存的、面板传的都过这一道） */
export function resolveScope(scope?: Partial<ScheduleScope> | null): ScheduleScope {
  const days = Math.round(scope?.windowDays ?? SCHEDULE_WINDOW_DAYS);
  const windowDays = days >= 1 && days <= SCHEDULE_WINDOW_MAX_DAYS ? days : SCHEDULE_WINDOW_DAYS;
  const dayPartId = SCHEDULE_DAY_PARTS.some((p) => p.id === scope?.dayPartId)
    ? (scope?.dayPartId as string)
    : 'all';
  return { windowDays, dayPartId };
}

/** 时段 id → 时段档（认不出来就回全天） */
export function dayPartOf(id: string | null | undefined): ScheduleDayPart {
  return SCHEDULE_DAY_PARTS.find((p) => p.id === id) ?? SCHEDULE_DAY_PARTS[0];
}

/** 一个时段 → 「08:00–22:00」 */
export function describeSlot(slot: ScheduleSlot): string {
  return `${minutesToClock(slot.startMinutes)}–${minutesToClock(slot.endMinutes)}`;
}

/** 条件 → 一句人话，界面上那行「未来 7 天 · 全天」就用它 */
export function describeScope(scope: ScheduleScope): string {
  return `未来 ${scope.windowDays} 天 · ${dayPartOf(scope.dayPartId).label}`;
}

/**
 * 一个建议时段是不是整段落在允许时段里。
 *
 * **必须完整落在某一个 slot 内**，不能"跨"也不能"擦边"：
 * 一条 11:30–12:30 的建议说不清它是上午的还是下午的，而用户看到的
 * 只是一次"我明明选了上午，它给我排到了中午"。
 */
export function inAllowedSlots(
  startMinutes: number,
  endMinutes: number,
  slots: readonly ScheduleSlot[],
): boolean {
  return slots.some((slot) => startMinutes >= slot.startMinutes && endMinutes <= slot.endMinutes);
}

/**
 * 把模型返回的原始安排洗成**可用**的建议。
 *
 * 四道闸，任何一道不过就丢掉这一条（不猜、不修）：
 * 1. `id` 必须在候选里 —— 模型偶尔会造 id 或写错一个字符；
 * 2. 日期必须是合法 `yyyy-MM-dd`，且落在 [今天, 今天+窗口] 内；
 * 3. 起止是合法分钟且 `end > start`；
 * 4. 时长在 [MIN, MAX] 内。
 *
 * 5. **时段必须整段落在"可调条件"给的范围里**（用户选了上午就只排上午）。
 *
 * 同一个 id 只保留第一条（模型可能给同一条两个方案，先到的算数）。
 *
 * 第五道闸是**界面说了算、模型不算**的典型：条件由用户调，模型只负责在
 * 这个框里挑哪天哪段。它排到框外，就直接丢 —— 不替它挪进来，因为挪的结果
 * 用户看不出是被改过的。
 */
export function sanitizePlans(
  raw: unknown,
  candidates: readonly ScheduleCandidate[],
  now: Date = new Date(),
  scope: ScheduleScope = DEFAULT_SCHEDULE_SCOPE,
): SchedulePlan[] {
  if (!Array.isArray(raw)) return [];

  const known = new Set(candidates.map((c) => c.id));
  const today = startOfDay(now);
  const seen = new Set<string>();
  const plans: SchedulePlan[] = [];
  const limit = resolveScope(scope);
  const slots = dayPartOf(limit.dayPartId).slots;

  for (const item of raw) {
    if (plans.length >= SCHEDULE_PLANS_MAX) break;
    if (typeof item !== 'object' || item == null) continue;
    const o = item as Record<string, unknown>;

    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id || !known.has(id) || seen.has(id)) continue;

    const dayKey = normalizeDayKey(o.day);
    if (!dayKey) continue;
    const day = strictDayKey(dayKey);
    if (!day) continue;
    const offset = differenceInCalendarDays(day, today);
    if (offset < 0 || offset > limit.windowDays) continue;

    const start = parseClock(o.start);
    const end = parseClock(o.end);
    if (start == null || end == null || end <= start) continue;
    const span = end - start;
    if (span < SCHEDULE_MIN_MINUTES || span > SCHEDULE_MAX_MINUTES) continue;
    if (!inAllowedSlots(start, end, slots)) continue;

    seen.add(id);
    plans.push({ id, dayKey, startMinutes: start, endMinutes: end });
  }

  return plans;
}

/**
 * 建议 → 落库用的时间（固定时段）。
 *
 * 走 `buildSpanTime`，与"在日历某天拖出一个时段"**同一条换算** ——
 * 只差一次 `setHours` 的写法就会造出差一天的日程，那种 bug 在界面上
 * 只是"我明明让它排周三，它跑到周二了"，极难归因。
 */
export function planToTime(plan: SchedulePlan): TaskTime | null {
  const day = strictDayKey(plan.dayKey);
  if (!day) return null;
  return buildSpanTime(day, plan.startMinutes, plan.endMinutes);
}

/** 建议 → 人看的文案，如「10月15日 周三 14:00–15:00」 */
export function describePlan(plan: SchedulePlan): string {
  const clock = `${minutesToClock(plan.startMinutes)}–${minutesToClock(plan.endMinutes)}`;
  const day = parseDayKey(plan.dayKey);
  if (!day) return clock;
  return `${format(day, 'M月d日')} ${WEEKDAY_LABELS[day.getDay()]} ${clock}`;
}

/** 只认 `yyyy-MM-dd`（把 `/` 也当分隔符）；其它形态一律不用 */
function normalizeDayKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * 严格解析 `yyyy-MM-dd`。
 *
 * `parseDayKey` 会把越界的月/日**归一化**（`2026-13-40` 滚成次年 2 月）——
 * 那对"用户输入"是宽容，对"模型输出"却是隐患：一个被悄悄滚走的日期，
 * 在界面上只是"我明明让它排 13 号"。所以这里做一次**回环校验**，
 * 归一化过的日期一律当不合法（返回 null）。
 */
function strictDayKey(key: string): Date | null {
  const day = parseDayKey(key);
  if (!day) return null;
  return toDayKey(day) === key ? day : null;
}

/** `"HH:mm"` 或直接给分钟数 → 当天分钟；越界返回 null */
function parseClock(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const m = Math.round(value);
    return m >= 0 && m <= 24 * 60 ? m : null;
  }
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total <= 24 * 60 ? total : null;
}

/** 当天分钟 → `HH:mm` */
function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
