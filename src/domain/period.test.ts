import { describe, expect, it } from 'vitest';

import { createPeriodLog } from '@/domain/factory';
import { periodDayKeys, predictPeriod, type PeriodLog, type PeriodPrefs } from '@/domain/period';
import { toDayKey } from '@/utils/datetime';

const prefs: PeriodPrefs = { cycleLength: 28, periodLength: 5 };

function log(start: Date, length = 5): PeriodLog {
  return { ...createPeriodLog(start, length), id: `p-${toDayKey(start)}` };
}

describe('predictPeriod', () => {
  it('没有记录时不预测（hasData=false，不崩）', () => {
    const f = predictPeriod([], prefs, new Date('2026-10-14'));
    expect(f.hasData).toBe(false);
    expect(f.phase).toBe('unknown');
    expect(f.nextStart).toBeUndefined();
  });

  it('记过一次后，能推出下次来潮日与倒计时', () => {
    const today = new Date('2026-10-14');
    const last = new Date('2026-09-30'); // 14 天前
    const f = predictPeriod([log(last)], prefs, today);
    expect(f.hasData).toBe(true);
    // 9/30 + 28 天 = 10/28，距今还有 14 天
    expect(toDayKey(f.nextStart!)).toBe('2026-10-28');
    expect(f.daysUntilNext).toBe(14);
  });

  it('经期进行中：相位 period，dayOfPeriod 正确', () => {
    const today = new Date('2026-10-02'); // 9/30 来潮的第 3 天
    const last = new Date('2026-09-30');
    const f = predictPeriod([log(last)], prefs, today);
    expect(f.phase).toBe('period');
    expect(f.dayOfPeriod).toBe(3);
  });

  it('漏记了一整个周期：顺着周期推到第一个未来的来潮日，不回退到过去', () => {
    const today = new Date('2026-12-01');
    const last = new Date('2026-09-30'); // 早过了好几个周期
    const f = predictPeriod([log(last)], prefs, today);
    expect(f.hasData).toBe(true);
    expect(f.nextStart! > today).toBe(true);
    // 下次来潮应是 9/30 之后、离 12/01 最近的 28 的倍数
    const diff = Math.round((f.nextStart!.getTime() - last.getTime()) / 864e5);
    expect(diff % 28).toBe(0);
    expect(f.daysUntilNext!).toBeGreaterThanOrEqual(0);
  });
});

describe('periodDayKeys', () => {
  it('把已记的经期铺成一组日子，并补上预测的下次经期', () => {
    const today = new Date('2026-10-14');
    const last = new Date('2026-09-30');
    const logs = [log(last)];
    const forecast = predictPeriod(logs, prefs, today);
    const period = periodDayKeys(logs, forecast);

    // 上次经期 5 天都在里面
    expect(period.has('2026-09-30')).toBe(true);
    expect(period.has('2026-10-04')).toBe(true);
    expect(period.has('2026-10-05')).toBe(false);

    // 预测的下次经期 10/28–11/01 也在里面
    expect(period.has('2026-10-28')).toBe(true);
    expect(period.has('2026-11-01')).toBe(true);
  });

  it('历史多次记录都画出来', () => {
    const today = new Date('2026-10-14');
    const logs = [log(new Date('2026-09-30')), log(new Date('2026-09-02'))];
    const forecast = predictPeriod(logs, prefs, today);
    const period = periodDayKeys(logs, forecast);
    expect(period.has('2026-09-02')).toBe(true);
    expect(period.has('2026-09-06')).toBe(true);
  });
});
