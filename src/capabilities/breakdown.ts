import { BREAKDOWN_STEP_MAX } from '@/domain/task-breakdown';

import type { CapabilitySpec } from './types';

/**
 * 能力「拆解」（主文档 3.1 Breakdown）：一件事 → 几步能动手的步骤。
 *
 * **为什么现在才接**：任务详情页的子任务一直是通的，手写那条路的成本是
 * "用户得自己想清楚每一步"——而"我也不知道从哪下手"恰恰是最需要拆的场景。
 * AI 在这里的价值不是更准，是**先给一版，让用户改**。
 *
 * ⚠️ 这条能力**只服务任务**（任务详情页的「拆解」）。想法那边不拆 ——
 * 想法转成任务只建一条任务（`domain/idea-to-task`），要拆去那条任务的详情页拆。
 *
 * 三条边界，都是为了"AI 出的东西不许直接进库"：
 *
 * 1. **只出步骤，不落库。** 这里返回的是一份**建议**，用户必须在面板上过一遍
 *    （删、改、调序）才落库。与「理解」不同 —— 理解错一条日程用户看不出来，
 *    拆错一步也看不出来，所以同样一个"先给用户看"的原则，拆解是靠界面兜住的。
 * 2. **不合格就整体作废**（`parse` 返回 null）：不是数组、没有步骤、
 *    洗完全空。宁可让用户自己写，也不给他一份半成品当成品。
 * 3. **上限比手写更严**（`BREAKDOWN_SUGGEST_MAX` < `BREAKDOWN_STEP_MAX`）。
 *    AI 一口气吐 20 步是"看起来很努力"，实际没人看得完 —— 拆的意义是
 *    "下一步做什么"，不是把事情切碎。用户觉得不够，面板上还能自己加。
 */

/** AI 一次最多建议几步。比手写的上限小，因为"建议"是要人一屏看完的 */
export const BREAKDOWN_SUGGEST_MAX = 8;

/** 一步写多长。子任务在列表里是一行，超了这个长度就扫不出来了 */
const STEP_TEXT_MAX = 30;

export interface BreakdownSuggestion {
  /** 洗过的步骤，顺序保留。至少一步，至多 BREAKDOWN_SUGGEST_MAX 步 */
  steps: string[];
}

export const breakdownSpec: CapabilitySpec<BreakdownSuggestion> = {
  system: () => `你是一个中文任务拆解助手。用户会给你一件要做的事，你要把它拆成几步能立刻动手的具体动作。

只输出一个 JSON 对象，不要输出解释、不要用 markdown 代码块：
{
  "steps": ["第一步", "第二步"]
}

规则：
- 每步**不超过 ${STEP_TEXT_MAX} 字**，且是能直接开做的动作（"找 3 篇相关论文"可以，"调研"不行）。
- 步数 **3 到 ${BREAKDOWN_SUGGEST_MAX} 步**。少于 3 步说明不用拆，多于 ${BREAKDOWN_SUGGEST_MAX} 步说明拆得太碎。
- 按**先后**顺序排，第一步是现在就能做的。
- 不要重复，不要包含"完成""结束"这类收尾步骤。
- 不要写序号前缀（"1." "第一步"），只写动作本身。
- 用户输入里可能带备注；只拆这件事本身，不要新造它没提到的动作。
- 只输出 JSON。`,
  user: (text, context) => {
    const existing = readExisting(context);
    const note = typeof context?.note === 'string' ? context.note.trim() : '';
    const lines = [`要拆的事：${text}`];
    if (note) lines.push(`备注：${note}`);
    // 已经拆出来的步骤要告诉它 —— 否则它会把"查文献"再建议一遍，
    // 而用户看见重复只会觉得"这玩意没用"
    if (existing.length) lines.push(`已经有的步骤（不要重复）：${existing.join('、')}`);
    return lines.join('\n');
  },
  parse: (raw) => parseBreakdown(raw),
};

/**
 * 把模型返回的 JSON 校验、洗成步骤数组。
 * 返回 null = 这份结果不能用（界面退回"自己写"）。
 */
export function parseBreakdown(raw: unknown): BreakdownSuggestion | null {
  if (typeof raw !== 'object' || raw == null) return null;

  const obj = raw as Record<string, unknown>;
  const list = obj.steps;
  if (!Array.isArray(list)) return null;

  const steps = cleanSuggestions(list);
  // 一步都洗不出来 —— 与"没拆"是同一件事，交给界面退回手写
  return steps.length ? { steps } : null;
}

/**
 * 洗步骤：去空、去重、截断、限条数、保序。
 *
 * 与 `domain/task-breakdown.cleanBreakdownSteps` 是**同一套口径**（都为了"落库前最后一道闸"），
 * 这里多一步 `STEP_TEXT_MAX` 截断，因为模型不知道我们的列表一行有多宽。
 */
function cleanSuggestions(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const steps: string[] = [];

  for (const item of list) {
    if (typeof item !== 'string') continue;
    const step = item.trim().replace(/^\s*\d+[.、)]\s*/, '').trim();
    if (!step || seen.has(step)) continue;
    seen.add(step);
    steps.push(step.slice(0, STEP_TEXT_MAX));
    if (steps.length >= BREAKDOWN_SUGGEST_MAX) break;
  }

  return steps;
}

/** 已有步骤：只在都是字符串时才用，脏数据宁可不用（它只是"别重复"的提示） */
function readExisting(context?: Record<string, unknown>): string[] {
  const raw = context?.existing;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}
