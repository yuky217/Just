import { describe, expect, it } from 'vitest';

import { SCHEDULE_PLANS_MAX } from '@/domain/schedule-suggest';

import { describeCandidates, parseScheduleSuggestion } from './schedule';

describe('parseScheduleSuggestion', () => {
  it('形状正确时取回 plans', () => {
    const out = parseScheduleSuggestion({
      plans: [{ id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' }],
    });
    expect(out).toEqual({ plans: [{ id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' }] });
  });

  it('非对象 / plans 不是数组 / 空 → null', () => {
    expect(parseScheduleSuggestion(null)).toBeNull();
    expect(parseScheduleSuggestion('x')).toBeNull();
    expect(parseScheduleSuggestion({ plans: 'x' })).toBeNull();
    expect(parseScheduleSuggestion({ plans: [] })).toBeNull();
  });

  it('丢掉缺字段的脏项，其余保留', () => {
    const out = parseScheduleSuggestion({
      plans: [
        { id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' },
        { id: '', day: '2026-10-15', start: '14:00', end: '15:00' },
        { id: 'c', day: '2026-10-15', start: '14:00' },
        'nope',
      ],
    });
    expect(out?.plans.map((p) => p.id)).toEqual(['a']);
  });

  it('最多 SCHEDULE_PLANS_MAX 条', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      day: '2026-10-15',
      start: '14:00',
      end: '15:00',
    }));
    expect(parseScheduleSuggestion({ plans: many })?.plans).toHaveLength(SCHEDULE_PLANS_MAX);
  });
});

describe('describeCandidates', () => {
  it('带上今天、id 与优先级/截止', () => {
    const text = describeCandidates(
      [
        { id: 'a', title: '写周报', durationMinutes: 60 },
        { id: 'b', title: '交材料', priorityLabel: '高', dueLabel: '10月20日' },
      ],
      new Date('2026-10-14T09:00:00'),
    );
    expect(text).toContain('今天：2026-10-14');
    expect(text).toContain('id=a');
    expect(text).toContain('写周报');
    expect(text).toContain('优先级：高');
    expect(text).toContain('截止：10月20日');
  });
});
