import { describe, expect, it } from 'vitest';

import { IDEA_TASK_TITLE_MAX, planIdeaTask } from './idea-to-task';

/**
 * 想法 → 任务的口径测试。
 *
 * 这一层的规则**肉眼看不出来**：标题该取第一行还是整段、截断之后原文还在不在 ——
 * 改错了页面照样能跑，只是待办里悄悄多出一条糊成一团的巨长任务。
 */

describe('planIdeaTask', () => {
  it('单行想法：标题就是那一行，note 空着（写两遍是噪音）', () => {
    expect(planIdeaTask('做校园二手书平台')).toEqual({
      title: '做校园二手书平台',
      note: null,
    });
  });

  it('多行想法：标题取第一个非空行，整段原文留在 note 里', () => {
    const content = '做校园二手书平台\n先从同宿舍楼试起来，别一上来就全校';
    const plan = planIdeaTask(content);
    expect(plan?.title).toBe('做校园二手书平台');
    expect(plan?.note).toBe(content);
  });

  it('前面拖了空行也不影响：取第一个非空行当标题', () => {
    expect(planIdeaTask('\n\n  做校园二手书平台  \n展开一句')?.title).toBe('做校园二手书平台');
  });

  it('第一行过长：截断标题，但整段原文一个字都不丢', () => {
    const long = '这是一条特别长的想法'.repeat(6);
    const plan = planIdeaTask(long);
    expect(plan?.title).toHaveLength(IDEA_TASK_TITLE_MAX);
    expect(plan?.note).toBe(long);
    // 截断不等于丢弃：原文必须以某个形式完整留着
    expect(plan?.note).toContain(long.slice(IDEA_TASK_TITLE_MAX));
  });

  it('想法是空的：返回 null（空标题的任务没有存在的意义）', () => {
    expect(planIdeaTask('   ')).toBeNull();
    expect(planIdeaTask('\n\n  \n')).toBeNull();
  });
});
