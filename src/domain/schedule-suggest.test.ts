import { describe, expect, it } from 'vitest';

import { TimeAttribute } from './enums';
import {
  DEFAULT_SCHEDULE_SCOPE,
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_PLANS_MAX,
  SCHEDULE_WINDOW_DAYS,
  describePlan,
  describeScope,
  planToTime,
  resolveScope,
  sanitizePlans,
  type ScheduleCandidate,
} from './schedule-suggest';

const now = new Date('2026-10-14T09:00:00');

const candidates: ScheduleCandidate[] = [
  { id: 'a', title: '写周报', durationMinutes: 60 },
  { id: 'b', title: '跑步', priorityLabel: '高' },
  { id: 'c', title: '背单词' },
];

describe('sanitizePlans', () => {
  it('只保留 id 在候选里的建议', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' },
        { id: 'zzz', day: '2026-10-15', start: '14:00', end: '15:00' },
      ],
      candidates,
      now,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('a');
  });

  it('丢掉窗口外的日期（昨天 / 超过窗口天数）', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-13', start: '14:00', end: '15:00' }, // 昨天
        { id: 'b', day: '2026-10-25', start: '14:00', end: '15:00' }, // 11 天后
        { id: 'c', day: '2026-10-15', start: '14:00', end: '15:00' }, // 窗口内
      ],
      candidates,
      now,
    );
    expect(plans.map((p) => p.id)).toEqual(['c']);
  });

  it('窗口边界：今天与今天+7 天都算数', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-14', start: '14:00', end: '15:00' },
        { id: 'b', day: '2026-10-21', start: '14:00', end: '15:00' },
      ],
      candidates,
      now,
    );
    expect(plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(SCHEDULE_WINDOW_DAYS).toBe(7);
  });

  it('丢掉 end <= start 或时长越界的建议', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '15:00', end: '15:00' }, // 零时长
        { id: 'b', day: '2026-10-15', start: '15:00', end: '14:00' }, // 反了
        { id: 'c', day: '2026-10-15', start: '15:00', end: '15:10' }, // 10 分钟 < 下限
      ],
      candidates,
      now,
    );
    expect(plans).toHaveLength(0);
  });

  it('时长上限：超过上限丢掉，正好上限保留', () => {
    const start = 9 * 60;
    const okEnd = start + SCHEDULE_MAX_MINUTES; // 正好上限
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '09:00', end: okEnd }, // 分钟数也认
        { id: 'b', day: '2026-10-15', start: '09:00', end: '20:00' }, // 11 小时
      ],
      candidates,
      now,
    );
    expect(plans.map((p) => p.id)).toEqual(['a']);
    expect(plans[0].endMinutes - plans[0].startMinutes).toBe(SCHEDULE_MAX_MINUTES);
  });

  it('同一条只保留第一个方案', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' },
        { id: 'a', day: '2026-10-16', start: '10:00', end: '11:00' },
      ],
      candidates,
      now,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].dayKey).toBe('2026-10-15');
  });

  it('最多 SCHEDULE_PLANS_MAX 条', () => {
    const many: ScheduleCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      title: `事 ${i}`,
    }));
    const raw = many.map((c) => ({ id: c.id, day: '2026-10-15', start: '14:00', end: '15:00' }));
    const plans = sanitizePlans(raw, many, now);
    expect(plans).toHaveLength(SCHEDULE_PLANS_MAX);
  });

  it('非数组 / 脏项一律不炸', () => {
    expect(sanitizePlans(null, candidates, now)).toEqual([]);
    expect(sanitizePlans('nope', candidates, now)).toEqual([]);
    expect(sanitizePlans([null, 1, 'x', {}], candidates, now)).toEqual([]);
  });
});

/*
  排期条件（2026-10-15）：不传就是默认值，传了就得真的挡住窗口外的建议。
  这两组用例是"可调"这件事的全部保证 —— 提示词是软的，模型会跑偏，
  只有 domain 这一道闸是硬的。
*/
describe('排期条件', () => {
  it('默认 = 7 天 · 全天（不调的人零操作）', () => {
    expect(DEFAULT_SCHEDULE_SCOPE).toEqual({ windowDays: 7, dayPartId: 'all' });
    expect(describeScope(DEFAULT_SCHEDULE_SCOPE)).toBe('未来 7 天 · 白天');
  });

  it('窗口调成 3 天：第 5 天那条被丢掉', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' }, // +1 天
        { id: 'b', day: '2026-10-19', start: '14:00', end: '15:00' }, // +5 天，窗口外
      ],
      candidates,
      now,
      { windowDays: 3, dayPartId: 'all' },
    );
    expect(plans.map((p) => p.id)).toEqual(['a']);
  });

  it('窗口调成 14 天：第 11 天那条留得住', () => {
    const plans = sanitizePlans(
      [{ id: 'b', day: '2026-10-25', start: '14:00', end: '15:00' }],
      candidates,
      now,
      { windowDays: 14, dayPartId: 'all' },
    );
    expect(plans.map((p) => p.id)).toEqual(['b']);
  });

  it('时段调成上午：14:00 那条被丢，09:00 那条留', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '14:00', end: '15:00' }, // 下午
        { id: 'b', day: '2026-10-15', start: '09:00', end: '10:00' }, // 上午
      ],
      candidates,
      now,
      { windowDays: 7, dayPartId: 'morning' },
    );
    expect(plans.map((p) => p.id)).toEqual(['b']);
  });

  it('压着时段边界（07:00 起）不算上午 —— 必须完整落在时段内', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '07:00', end: '08:30' }, // 跨进上午
        { id: 'b', day: '2026-10-15', start: '11:00', end: '12:00' }, // 正好到 12:00
      ],
      candidates,
      now,
      { windowDays: 7, dayPartId: 'morning' },
    );
    expect(plans.map((p) => p.id)).toEqual(['b']);
  });

  it('时段调成晚上：上午下午的都不要', () => {
    const plans = sanitizePlans(
      [
        { id: 'a', day: '2026-10-15', start: '09:00', end: '10:00' },
        { id: 'b', day: '2026-10-15', start: '15:00', end: '16:00' },
        { id: 'c', day: '2026-10-15', start: '19:00', end: '20:00' },
      ],
      candidates,
      now,
      { windowDays: 7, dayPartId: 'evening' },
    );
    expect(plans.map((p) => p.id)).toEqual(['c']);
  });

  it('条件洗不干净就回默认（越界天数 / 认不出的时段 id）', () => {
    expect(resolveScope({ windowDays: 999, dayPartId: 'hack' })).toEqual({
      windowDays: SCHEDULE_WINDOW_DAYS,
      dayPartId: 'all',
    });
    expect(resolveScope({ windowDays: 2.6 })).toEqual({ windowDays: 3, dayPartId: 'all' });
    expect(resolveScope(null)).toEqual(DEFAULT_SCHEDULE_SCOPE);
  });
});

describe('planToTime', () => {
  it('落成固定时段，起止对得上', () => {
    const time = planToTime({ id: 'a', dayKey: '2026-10-15', startMinutes: 14 * 60, endMinutes: 15 * 60 });
    expect(time).not.toBeNull();
    expect(time!.attribute).toBe(TimeAttribute.Fixed);
    expect(new Date(time!.startAt!).getHours()).toBe(14);
    expect(new Date(time!.endAt!).getHours()).toBe(15);
  });

  it('非法日期返回 null', () => {
    expect(planToTime({ id: 'a', dayKey: '2026-13-40', startMinutes: 60, endMinutes: 120 })).toBeNull();
  });
});

describe('describePlan', () => {
  it('带周几与时刻', () => {
    // 2026-10-15 是周四
    expect(describePlan({ id: 'a', dayKey: '2026-10-15', startMinutes: 14 * 60, endMinutes: 15 * 60 })).toBe(
      '10月15日 周四 14:00–15:00',
    );
  });
});
