import { describe, expect, it } from 'vitest';

import {
  CaptureSource,
  CompletionRule,
  Priority,
  SyncState,
  TaskKind,
  TaskStatus,
  TimeAttribute,
} from './enums';
import type { Course, Term } from './course';
import type { CalEvent } from './event';
import type { Task } from './task';
import { collectWidgetDays } from './widget-days';

/** 基准：2026-10-11（周日）15:00 本地时间 */
const NOW = new Date(2026, 9, 11, 15, 0, 0, 0);

function makeTask(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncState: SyncState.Local,
    title: `任务 ${id}`,
    kind: TaskKind.Execution,
    status: TaskStatus.Todo,
    time: { attribute: TimeAttribute.None },
    completion: CompletionRule.Check,
    tags: [],
    priority: Priority.P2,
    source: CaptureSource.Manual,
    progress: { accumulatedMinutes: 0 },
    ...patch,
  };
}

const fixedOn = (y: number, m: number, d: number, hour = 9) => ({
  attribute: TimeAttribute.Fixed,
  startAt: new Date(y, m - 1, d, hour).toISOString(),
  endAt: null,
  dueAt: null,
});

function makeExam(id: string, startAt: string, patch: Partial<CalEvent> = {}): CalEvent {
  return {
    id,
    createdAt: startAt,
    updatedAt: startAt,
    syncState: SyncState.Local,
    kind: 'exam',
    title: `考试 ${id}`,
    location: null,
    note: null,
    startAt,
    endAt: null,
    source: 'manual',
    ...patch,
  };
}

const TERM: Term = {
  id: 'term',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  syncState: SyncState.Local,
  label: '2026-2027-1',
  // 2026-10-05 是周一 → 10-11 是第 1 周周日
  startDayKey: '2026-10-05',
  totalWeeks: 16,
  periods: [{ index: 1, start: 8 * 60, end: 8 * 60 + 45 }],
};

const COURSE_MON: Course = {
  id: 'course',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  syncState: SyncState.Local,
  title: '高数',
  colorIndex: 0,
  sessions: [{ weekday: 1, startPeriod: 1, endPeriod: 1, weeks: [1, 2, 3] }],
};

describe('collectWidgetDays：周卡 / 月卡的按天口径', () => {
  it('空输入：全是零、没有圆点', () => {
    const cells = collectWidgetDays({
      tasks: [],
      events: [],
      courses: [],
      term: null,
      from: NOW,
      days: 3,
      now: NOW,
    });
    expect(cells).toHaveLength(3);
    for (const [i, cell] of cells.entries()) {
      expect(cell.key).toBe(
        `2026-10-${String(11 + i).padStart(2, '0')}`,
      );
      expect(cell.tasks).toBe(0);
      expect(cell.dots).toEqual([]);
    }
    expect(cells[0].isToday).toBe(true);
    expect(cells[1].isToday).toBe(false);
  });

  it('任务按锚点日分桶，openTasks 只数没做完的 —— 与日历页 countsByDay 同一条', () => {
    const cells = collectWidgetDays({
      tasks: [
        makeTask('a', { time: fixedOn(2026, 10, 11, 10) }),
        makeTask('b', { time: fixedOn(2026, 10, 11, 14), status: TaskStatus.Done }),
        makeTask('c', { time: fixedOn(2026, 10, 12, 9) }),
        // 没时间的任务不落任何一天（待办的东西不该在日历卡上冒出来）
        makeTask('d'),
      ],
      events: [],
      courses: [],
      term: null,
      from: NOW,
      days: 2,
      now: NOW,
    });
    expect(cells[0]).toMatchObject({ tasks: 2, openTasks: 1 });
    expect(cells[1]).toMatchObject({ tasks: 1, openTasks: 1 });
    // 圆点：任务点，先没做完的（深）后做完的（浅）
    expect(cells[0].dots).toEqual([
      { kind: 'task', open: true },
      { kind: 'task', open: false },
    ]);
  });

  it('考试按 startAt 分桶，形状是方块（exam）', () => {
    const cells = collectWidgetDays({
      tasks: [],
      events: [makeExam('e1', fixedOn(2026, 10, 12, 9).startAt)],
      courses: [],
      term: null,
      from: NOW,
      days: 2,
      now: NOW,
    });
    expect(cells[0].exams).toBe(0);
    expect(cells[1].exams).toBe(1);
    expect(cells[1].dots).toEqual([{ kind: 'exam' }]);
  });

  it('课按课表换算（10-12 是第 1 周周一，那节高数算上）', () => {
    const cells = collectWidgetDays({
      tasks: [],
      events: [],
      courses: [COURSE_MON],
      term: TERM,
      from: NOW,
      days: 2,
      now: NOW,
    });
    // 10-11 周日：没课
    expect(cells[0].courses).toBe(0);
    // 10-12 周一：第 1 周，高数第 1 节
    expect(cells[1].courses).toBe(1);
    expect(cells[1].dots).toEqual([{ kind: 'course' }]);
  });

  it('形状语言与月历一致：课(空心)在队首、任务永远保得住名额', () => {
    const cells = collectWidgetDays({
      tasks: [
        makeTask('a', { time: fixedOn(2026, 10, 12, 10) }),
        makeTask('b', { time: fixedOn(2026, 10, 12, 11) }),
        makeTask('c', { time: fixedOn(2026, 10, 12, 12) }),
        makeTask('d', { time: fixedOn(2026, 10, 12, 13) }),
      ],
      events: [makeExam('e1', fixedOn(2026, 10, 12, 15).startAt)],
      courses: [COURSE_MON],
      term: TERM,
      from: new Date(2026, 9, 12),
      days: 1,
      now: NOW,
    });
    // 4 个未完成任务 + 1 考试 + 1 课 → 名额 3 全给任务（任务 > 考试 > 课，
    // 与 domain/calendar-shape 的配额规则一致：先丢课、再丢考试、任务永远留着）
    expect(cells[0].dots).toEqual([
      { kind: 'task', open: true },
      { kind: 'task', open: true },
      { kind: 'task', open: true },
    ]);
    expect(cells[0].exams).toBe(1);
    expect(cells[0].courses).toBe(1);
  });

  it('月卡：inMonth 标出补位格（10 月从周四开始，网格 42 格）', () => {
    const cells = collectWidgetDays({
      tasks: [],
      events: [],
      courses: [],
      term: null,
      // 2026-10 的整张网格：10-01 是周四，网格从 09-28（周一）起
      from: new Date(2026, 8, 28),
      days: 42,
      month: new Date(2026, 9, 15),
      now: NOW,
    });
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ key: '2026-09-28', inMonth: false });
    expect(cells.find((c) => c.key === '2026-10-01')).toMatchObject({ inMonth: true });
    expect(cells[41]).toMatchObject({ key: '2026-11-08', inMonth: false });
  });
});
