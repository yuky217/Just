import { startOfDay, startOfMonth, startOfWeek } from 'date-fns';

import type { Idea } from './idea';

/**
 * 想法页的检索口径：**时间范围 × 标签 × 关键词**，三者正交、可叠加。
 *
 * 收在一个纯函数里而不是写在页面里，是因为它们会互相影响：
 * "筛了标签又搜了词，结果空了"到底是条件太紧还是真的没有，
 * 只有在一条条能测的口径上才说得清（跟 `search.ts` / `todo.ts` 同一个理由）。
 */

/** 时间范围：只看"这段时间里记下的" */
export type IdeaTimeRange = 'all' | 'today' | 'week' | 'month';

/** 展示顺序＝从宽到窄 */
export const IDEA_TIME_RANGES: readonly IdeaTimeRange[] = ['all', 'today', 'week', 'month'];

export const IDEA_TIME_RANGE_LABEL: Readonly<Record<IdeaTimeRange, string>> = {
  all: '全部',
  today: '今天',
  week: '本周',
  month: '本月',
};

/** 周一为一周的第一天 —— 与日历页同一套（`calendar-window.ts` 的 WEEK_OPTIONS） */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

export interface IdeaFilter {
  /** 关键词：正文或标签里出现就算命中（与全库搜索口径一致） */
  keyword?: string;
  /** 只看带这个标签的（大小写不敏感，精确匹配整个标签） */
  tag?: string | null;
  /** 时间范围，按**记下的时间**（createdAt）算 */
  range?: IdeaTimeRange;
}

/** 这个范围从哪一刻算起。null = 不限（'all'） */
function rangeStart(range: IdeaTimeRange, now: Date): number | null {
  if (range === 'today') return startOfDay(now).getTime();
  if (range === 'week') return startOfWeek(now, WEEK_OPTIONS).getTime();
  if (range === 'month') return startOfMonth(now).getTime();
  return null;
}

export function filterIdeas(
  ideas: readonly Idea[],
  filter: IdeaFilter = {},
  now: Date = new Date(),
): Idea[] {
  const keyword = (filter.keyword ?? '').trim().toLowerCase();
  const tag = filter.tag ? filter.tag.toLowerCase() : null;
  const from = rangeStart(filter.range ?? 'all', now);

  return ideas.filter((idea) => {
    if (tag && !idea.tags.some((t) => t.toLowerCase() === tag)) return false;

    if (from !== null) {
      const at = new Date(idea.createdAt).getTime();
      // 时间读不出来的行，在"按时间筛"时不冒充命中
      if (Number.isNaN(at) || at < from) return false;
    }

    if (keyword) {
      const hit =
        idea.content.toLowerCase().includes(keyword) ||
        idea.tags.some((t) => t.toLowerCase().includes(keyword));
      if (!hit) return false;
    }

    return true;
  });
}
