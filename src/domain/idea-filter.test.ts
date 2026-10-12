import { describe, expect, it } from 'vitest';

import { CaptureSource, SyncState } from './enums';
import type { Idea } from './idea';
import { filterIdeas } from './idea-filter';

/**
 * 想法检索的口径测试：时间 × 标签 × 关键词。
 *
 * 这一层全是"看起来对、其实差一天/差一个字符"的规则 —— 比如"本周"到底从周一
 * 还是周日算起、标签是精确匹配还是子串。改错了页面照样能跑，只是会静默地
 * 少显示或多显示几条。
 *
 * 时间一律用**本地时间**构造，因为 startOfDay / startOfWeek 都按本地时区算。
 */

function idea(
  id: string,
  content: string,
  opts: { tags?: string[]; createdAt?: Date } = {},
): Idea {
  const at = (opts.createdAt ?? new Date(2026, 9, 12, 10, 0, 0)).toISOString();
  return {
    id,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    remoteId: null,
    syncState: SyncState.Local,
    content,
    tags: opts.tags ?? [],
    source: CaptureSource.Manual,
    archivedAt: null,
    convertedTaskId: null,
  };
}

/** 2026-10-12 是周一 */
const NOW = new Date(2026, 9, 12, 12, 0, 0);

describe('filterIdeas', () => {
  it('什么都不筛：原样返回', () => {
    const list = [idea('a', '买菜'), idea('b', '读书')];
    expect(filterIdeas(list, {}, NOW).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('关键词命中正文，大小写不敏感', () => {
    const list = [idea('a', '读 Deep Work'), idea('b', '买菜')];
    expect(filterIdeas(list, { keyword: 'deep' }, NOW).map((i) => i.id)).toEqual(['a']);
  });

  it('关键词也能命中标签', () => {
    const list = [idea('a', '随手一句', { tags: ['工作'] }), idea('b', '买菜')];
    expect(filterIdeas(list, { keyword: '工作' }, NOW).map((i) => i.id)).toEqual(['a']);
  });

  it('标签是精确匹配整个标签，不是子串', () => {
    const list = [idea('a', '一句', { tags: ['工作'] }), idea('b', '一句', { tags: ['工作台'] })];
    expect(filterIdeas(list, { tag: '工作' }, NOW).map((i) => i.id)).toEqual(['a']);
  });

  it('标签匹配大小写不敏感', () => {
    const list = [idea('a', '一句', { tags: ['Work'] })];
    expect(filterIdeas(list, { tag: 'work' }, NOW).map((i) => i.id)).toEqual(['a']);
  });

  it('今天：昨天记的不算', () => {
    const list = [
      idea('today', '今天记的', { createdAt: new Date(2026, 9, 12, 8, 0, 0) }),
      idea('yesterday', '昨天记的', { createdAt: new Date(2026, 9, 11, 23, 0, 0) }),
    ];
    expect(filterIdeas(list, { range: 'today' }, NOW).map((i) => i.id)).toEqual(['today']);
  });

  it('本周从周一起算：上周日的不算，本周一的算', () => {
    const list = [
      idea('sun', '上周日', { createdAt: new Date(2026, 9, 11, 20, 0, 0) }),
      idea('mon', '本周一', { createdAt: new Date(2026, 9, 12, 0, 30, 0) }),
    ];
    expect(filterIdeas(list, { range: 'week' }, NOW).map((i) => i.id)).toEqual(['mon']);
  });

  it('本月：上月的不算，本月初的算', () => {
    const list = [
      idea('sep', '上个月', { createdAt: new Date(2026, 8, 30, 20, 0, 0) }),
      idea('oct1', '本月一号', { createdAt: new Date(2026, 9, 1, 0, 10, 0) }),
    ];
    expect(filterIdeas(list, { range: 'month' }, NOW).map((i) => i.id)).toEqual(['oct1']);
  });

  it('三个条件叠加：都满足才留下', () => {
    const list = [
      idea('hit', '写周报', { tags: ['工作'], createdAt: new Date(2026, 9, 12, 9, 0, 0) }),
      idea('old', '写周报', { tags: ['工作'], createdAt: new Date(2026, 9, 1, 9, 0, 0) }),
      idea('other-tag', '写周报', { tags: ['生活'], createdAt: new Date(2026, 9, 12, 9, 0, 0) }),
      idea('other-text', '买菜', { tags: ['工作'], createdAt: new Date(2026, 9, 12, 9, 0, 0) }),
    ];
    const hits = filterIdeas(list, { keyword: '周报', tag: '工作', range: 'today' }, NOW);
    expect(hits.map((i) => i.id)).toEqual(['hit']);
  });

  it('时间读不出来的行，在按时间筛时不冒充命中', () => {
    const broken = { ...idea('broken', '一句'), createdAt: '' };
    expect(filterIdeas([broken], { range: 'today' }, NOW)).toEqual([]);
  });
});
