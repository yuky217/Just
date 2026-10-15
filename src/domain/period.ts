import { addDays, differenceInCalendarDays } from 'date-fns';

import { parseDayKey, toDayKey } from '@/utils/datetime';

import type { BaseEntity } from './base';

/**
 * 经期记录（一次性来潮记一行）。
 *
 * 为什么单独成表、不进 marks / events：它既不是"倒数几天的纪念日"，
 * 也不是"到点发生的事"，而是**周期性生理现象**。预测只靠"最近一次来潮日 +
 * 周期长度"推导，简单又稳；塞进那两套口径只会污染"倒数""到点提醒"的语义。
 *
 * 每条 = 一次来潮：startDayKey 是来潮当天，length 是这次持续几天。
 * 关掉功能时这一行**不删**（见 domain/features.ts 的铁律 1），重开数据还在原地。
 */
export interface PeriodLog extends BaseEntity {
  /** 来潮当天（本地日 yyyy-MM-dd） */
  startDayKey: string;
  /** 本次持续天数（默认 5） */
  length: number;
  note?: string | null;
}

/** 预测用的偏好，来自设置（周期长度 / 经期长度） */
export interface PeriodPrefs {
  /** 平均周期长度（两次来潮间隔天数），默认 28 */
  cycleLength: number;
  /** 经期持续天数，默认 5 */
  periodLength: number;
}

export type PeriodPhase = 'period' | 'follicular' | 'luteal' | 'unknown';

/**
 * 当前状态 + 下次预测。
 *
 * 首页卡和日历圆点都从这一份口径取数 —— 预测只写这一处，别处只负责显示。
 */
export interface PeriodForecast {
  /** 有没有足够的数据预测（至少记过一次） */
  hasData: boolean;
  lastStartDayKey?: string;
  phase: PeriodPhase;
  /** 当前周期第几天（从最近一次来潮起算，1-based）；无数据 / 未来记录为 undefined */
  cycleDay?: number;
  /** 经期进行中时，第几天（1-based） */
  dayOfPeriod?: number;
  /** 预测的下一次来潮日 */
  nextStart?: Date;
  /** 距离下次来潮还有几天（>0 未到，0 = 今天就来潮） */
  daysUntilNext?: number;
  periodLength: number;
  cycleLength: number;
}

export const DEFAULT_PERIOD_LENGTH = 5;
export const DEFAULT_CYCLE_LENGTH = 28;
/** 黄体期恒定约 14 天：经期后到下次来潮前的末段算黄体期 */
export const LUTEAL_DAYS = 14;

/**
 * 预测。
 *
 * 只认"最近一次"那个起点：周期长度取设置里的平均值，过去几次的规律差异
 * 暂时忽略（v1 不做滑动平均）。这样逻辑足够简单、出错面小，用户记几次后
 * 自然准起来；将来要更准，只改这一处。
 *
 * 边界：如果上次记的来潮日到今天已经跨过一个完整周期（用户漏记了），
 * 就**顺着周期往前推到第一个未来的来潮日**当 nextStart —— 否则会算出
 * 一个已经过去的"下次"，提醒就再也排不出去。这是提醒能响的前提。
 */
export function predictPeriod(
  logs: readonly PeriodLog[],
  prefs: PeriodPrefs,
  today: Date = new Date(),
): PeriodForecast {
  const base: PeriodForecast = {
    hasData: false,
    phase: 'unknown',
    periodLength: prefs.periodLength,
    cycleLength: prefs.cycleLength,
  };
  if (logs.length === 0) return base;

  const sorted = [...logs].sort((a, b) => (a.startDayKey < b.startDayKey ? 1 : -1));
  const last = sorted[0];
  const lastStart = parseDayKey(last.startDayKey);
  if (!lastStart) return base;

  const periodLength = Math.max(1, last.length || prefs.periodLength);
  const cycleLength = Math.max(periodLength + 1, prefs.cycleLength);

  const todayKey = toDayKey(today);
  const todayDate = parseDayKey(todayKey) ?? today;
  const cycleDay = differenceInCalendarDays(todayDate, lastStart) + 1;

  // 顺着周期往前推，找到第一个还没过的来潮日
  let nextStart = addDays(lastStart, cycleLength);
  while (differenceInCalendarDays(nextStart, todayDate) < 0) {
    nextStart = addDays(nextStart, cycleLength);
  }
  const daysUntilNext = differenceInCalendarDays(nextStart, todayDate);

  let phase: PeriodPhase;
  if (cycleDay < 1) {
    // 记的是未来的来潮：还没到
    phase = daysUntilNext === 0 ? 'period' : 'follicular';
  } else if (cycleDay <= periodLength) {
    phase = 'period';
  } else if (cycleDay > cycleLength - LUTEAL_DAYS) {
    // 临近下次来潮的后段算黄体期
    phase = 'luteal';
  } else {
    phase = 'follicular';
  }

  return {
    ...base,
    hasData: true,
    lastStartDayKey: last.startDayKey,
    phase,
    cycleDay: cycleDay >= 1 ? cycleDay : undefined,
    dayOfPeriod: phase === 'period' ? cycleDay : undefined,
    nextStart,
    daysUntilNext,
  };
}

/**
 * 把"某次来潮 + 预测"摊成一组要画在日历上的日子（经期覆盖的每一天）。
 * 历史已记的几次都画出来（让用户回看规律），下一次预测的也画出来（前瞻）。
 */
export function periodDayKeys(
  logs: readonly PeriodLog[],
  forecast: PeriodForecast,
): Set<string> {
  const period = new Set<string>();

  for (const log of logs) {
    const start = parseDayKey(log.startDayKey);
    if (!start) continue;
    const len = Math.max(1, log.length || forecast.periodLength);
    for (let i = 0; i < len; i += 1) period.add(toDayKey(addDays(start, i)));
  }

  if (forecast.nextStart) {
    for (let i = 0; i < forecast.periodLength; i += 1) {
      period.add(toDayKey(addDays(forecast.nextStart, i)));
    }
  }

  return period;
}
