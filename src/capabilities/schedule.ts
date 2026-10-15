import {
  DEFAULT_SCHEDULE_SCOPE,
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_MIN_MINUTES,
  SCHEDULE_PLANS_MAX,
  WEEKDAY_LABELS,
  dayPartOf,
  describeSlot,
  resolveScope,
  type ScheduleCandidate,
  type ScheduleScope,
} from '@/domain/schedule-suggest';
import { toDayKey } from '@/utils/datetime';

import type { CapabilitySpec } from './types';

/**
 * 能力「排期」（主文档 3.1 Schedule）：把一批"还没排时间"的事，
 * 结合优先级与截止，安排进未来一周。
 *
 * 与其他能力一致的边界：
 * 1. **只出建议，不落库**（`capabilities/schedule` 返回 plans，界面确认后才写）。
 * 2. **不合格就整体作废**（`parse` 返回 null）—— 一条 plans 都挑不出来，
 *    交给界面报错 + 让用户自己定，而不是摊一张空面板。
 * 3. **白名单在 domain**：模型的 id/日期/时段最终要过 `sanitizePlans` 四道闸，
 *    这里只做"形状对不对"，不替它判业务合法性。
 *
 * ⚠️ 这条能力**需要真实的候选清单**：`user` 收到的 `text` 是调用方
 * （`suggestSchedule`）拼好的候选清单（见 `describeCandidates`），不是用户原话。
 */

/** 模型直接吐回来的一条（形状层），业务净化交给 `domain/schedule-suggest.sanitizePlans` */
export interface RawSchedulePlan {
  id: string;
  day: string;
  start: string;
  end: string;
}

export interface ScheduleSuggestion {
  plans: RawSchedulePlan[];
}

/** 从 context 里取排期条件（取不到就是默认值 —— 不调条件的人一次都不用碰） */
function scopeOf(context?: Record<string, unknown>): ScheduleScope {
  const raw = context?.scope as Partial<ScheduleScope> | undefined;
  return raw ? resolveScope(raw) : DEFAULT_SCHEDULE_SCOPE;
}

export const scheduleSpec: CapabilitySpec<ScheduleSuggestion> = {
  system: (now, context) => {
    const scope = scopeOf(context);
    const part = dayPartOf(scope.dayPartId);
    const windows = part.slots.map(describeSlot).join('、');
    return `你是一个中文日程安排助手。用户会给你一份「待安排的任务清单」和今天的日期。
你要在**未来 ${scope.windowDays} 天**内、每天的 ${windows} 之间，给其中若干条各安排一个时段。

只输出一个 JSON 对象，不要输出解释、不要用 markdown 代码块：
{
  "plans": [
    { "id": "任务id", "day": "2026-10-15", "start": "14:00", "end": "15:00" }
  ]
}

规则：
- **只能**用清单里给出的 id，不要自己编造 id。
- day 用 yyyy-MM-dd 格式，且必须落在未来 ${scope.windowDays} 天内（含今天）。
- 时段必须**完整落在** ${windows} 之内（不能跨出去、不能压着边）；单段时长 ${SCHEDULE_MIN_MINUTES}–${SCHEDULE_MAX_MINUTES} 分钟。
- **截止越近、优先级越高的先排**：排在更靠前的日子、更早的时段。
- 最多安排 ${SCHEDULE_PLANS_MAX} 条；安排不下的**不要硬塞**，宁可少给几条。
- 同一条任务不要给两个时段。
- 只输出 JSON。`;
  },
  user: (text) => text,
  parse: (raw) => parseScheduleSuggestion(raw),
};

/**
 * 候选清单 → 提示词里的 `user` 文本。
 *
 * 只放模型真正用得上的四样：id（要回填）、标题、预计时长、优先级/截止。
 * 不放任务的其他字段 —— 多一寸上下文，就多一分它自由发挥的余地。
 */
export function describeCandidates(
  candidates: readonly ScheduleCandidate[],
  now: Date = new Date(),
  scope: ScheduleScope = DEFAULT_SCHEDULE_SCOPE,
): string {
  const part = dayPartOf(scope.dayPartId);
  const lines = [
    `今天：${toDayKey(now)}（${WEEKDAY_LABELS[now.getDay()]}）`,
    // 条件也写进 user：**系统提示词与清单口径一致**，模型两边看到同一句话
    `排期范围：未来 ${scope.windowDays} 天（含今天）；每天只在 ${part.slots
      .map(describeSlot)
      .join('、')} 之间安排。`,
    '待安排的任务：',
  ];
  for (const c of candidates) {
    const bits = [`id=${c.id}`, `标题：${c.title}`];
    if (c.durationMinutes) bits.push(`预计 ${c.durationMinutes} 分钟`);
    if (c.priorityLabel) bits.push(`优先级：${c.priorityLabel}`);
    if (c.dueLabel) bits.push(`截止：${c.dueLabel}`);
    lines.push(`- ${bits.join('，')}`);
  }
  return lines.join('\n');
}

/**
 * 把模型返回的 JSON 校验成形状正确的 `plans`。
 * 返回 null = 这份结果不能用（界面报错 + 让用户自己定）。
 *
 * 只判"形状"：是不是对象、plans 是不是数组、每条四个字段是不是非空字符串。
 * **业务合法性（id 存在 / 窗口 / 时长）交给 `sanitizePlans`** ——
 * 那一步需要候选清单，而这里（能力层）不该知道界面上的任务。
 */
export function parseScheduleSuggestion(raw: unknown): ScheduleSuggestion | null {
  if (typeof raw !== 'object' || raw == null) return null;
  const list = (raw as Record<string, unknown>).plans;
  if (!Array.isArray(list)) return null;

  const plans: RawSchedulePlan[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item == null) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const day = typeof o.day === 'string' ? o.day.trim() : '';
    const start = typeof o.start === 'string' ? o.start.trim() : '';
    const end = typeof o.end === 'string' ? o.end.trim() : '';
    if (!id || !day || !start || !end) continue;
    plans.push({ id, day, start, end });
    if (plans.length >= SCHEDULE_PLANS_MAX) break;
  }

  return plans.length ? { plans } : null;
}
