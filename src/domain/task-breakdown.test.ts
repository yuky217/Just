import { describe, expect, it } from 'vitest';

import { BREAKDOWN_STEP_MAX, cleanBreakdownSteps } from './task-breakdown';

/** 拆解步骤的清洗口径（手写与 AI 两条路共用同一道闸） */

describe('cleanBreakdownSteps', () => {
  it('去空、按原顺序合并重复', () => {
    expect(cleanBreakdownSteps(['查文献', '  ', '查文献', '定题目', '  查文献  '])).toEqual([
      '查文献',
      '定题目',
    ]);
  });

  it('超过上限时截到上限，不是无限装', () => {
    const many = Array.from({ length: BREAKDOWN_STEP_MAX + 5 }, (_, i) => `第 ${i + 1} 步`);
    expect(cleanBreakdownSteps(many)).toHaveLength(BREAKDOWN_STEP_MAX);
  });

  it('一个有效步骤都没有：返回空数组', () => {
    expect(cleanBreakdownSteps([])).toEqual([]);
    expect(cleanBreakdownSteps(['   ', '\n'])).toEqual([]);
  });
});
