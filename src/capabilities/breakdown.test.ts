import { describe, expect, it } from 'vitest';

import {
  BREAKDOWN_SUGGEST_MAX,
  breakdownSpec,
  parseBreakdown,
} from './breakdown';

/**
 * 「模型拆出来的东西能不能信」。
 *
 * 这里守的不是"拆得好不好"（那是主观的，而且用户会在面板上改），
 * 而是**这三件会真的坑到人的事**：
 * 1. 空步骤、重复步骤 —— 落库后列表里出现两条一模一样的"查文献"；
 * 2. 模型自作主张加的序号前缀 —— "1. 查文献"进了列表就成了"1. 查文献"，
 *    而列表本身已经在显示序号了；
 * 3. 一口气吐 30 步 —— 那不是拆解，是把事情切碎后扔给用户。
 */

describe('parseBreakdown', () => {
  it('正常读出一串步骤，顺序保留', () => {
    expect(parseBreakdown({ steps: ['定题目', '找文献', '写大纲'] })).toEqual({
      steps: ['定题目', '找文献', '写大纲'],
    });
  });

  it('空串与纯空格不算一步', () => {
    expect(parseBreakdown({ steps: ['定题目', '  ', '', '写大纲'] })).toEqual({
      steps: ['定题目', '写大纲'],
    });
  });

  it('重复的合并 —— 同一步写两遍是误操作，不是"要做两次"', () => {
    expect(parseBreakdown({ steps: ['查文献', ' 查文献 ', '定题目', '查文献'] })).toEqual({
      steps: ['查文献', '定题目'],
    });
  });

  it('剥掉模型自加的序号前缀（列表本身已经在显示序号了）', () => {
    expect(parseBreakdown({ steps: ['1. 定题目', '2、找文献', '3) 写大纲'] })).toEqual({
      steps: ['定题目', '找文献', '写大纲'],
    });
  });

  it('非字符串直接丢掉，不把对象/数字当一步', () => {
    expect(parseBreakdown({ steps: ['定题目', 42, null, { text: 'x' }, '写大纲'] })).toEqual({
      steps: ['定题目', '写大纲'],
    });
  });

  it(`最多 ${BREAKDOWN_SUGGEST_MAX} 步 —— 拆的意义是"下一步做什么"，不是切碎`, () => {
    const many = Array.from({ length: 30 }, (_, i) => `第${i}步`);
    const res = parseBreakdown({ steps: many });
    expect(res!.steps).toHaveLength(BREAKDOWN_SUGGEST_MAX);
    // 保序：截的是尾巴，不是随机挑
    expect(res!.steps[0]).toBe('第0步');
  });

  it('一步超长要截断（子任务在列表里是一行）', () => {
    const long = '先把去年所有的课程笔记从网盘上下载下来然后按章节整理成一个目录';
    const res = parseBreakdown({ steps: [long] });
    expect(res!.steps[0].length).toBeLessThanOrEqual(30);
  });

  it('一步都洗不出来 → null（界面退回"自己写"，而不是摊一张空面板）', () => {
    expect(parseBreakdown({ steps: [] })).toBeNull();
    expect(parseBreakdown({ steps: ['  ', ''] })).toBeNull();
  });

  it('steps 不是数组 / 根本不是对象 → null', () => {
    expect(parseBreakdown({ steps: '定题目' })).toBeNull();
    expect(parseBreakdown(null)).toBeNull();
    expect(parseBreakdown('定题目')).toBeNull();
  });
});

describe('breakdownSpec.user', () => {
  it('把备注和已有步骤都带进去', () => {
    const text = breakdownSpec.user('写毕业论文', {
      note: '导师要求 12 月前交初稿',
      existing: ['定题目'],
    });
    expect(text).toContain('写毕业论文');
    expect(text).toContain('12 月前交初稿');
    expect(text).toContain('定题目');
  });

  it('没有备注和已有步骤时只说要拆的事', () => {
    const text = breakdownSpec.user('写毕业论文', undefined);
    expect(text).toBe('要拆的事：写毕业论文');
  });

  it('已有的步骤不是字符串数组时宁可不带（它只是"别重复"的提示）', () => {
    const text = breakdownSpec.user('写毕业论文', { existing: [{ x: 1 }] as never });
    expect(text).not.toContain('已经有的步骤');
  });
});
