import { describe, expect, it } from 'vitest';

import { TaskStatus } from './enums';
import {
  desiredParentStatus,
  subtaskProgress,
  undoableBreakdown,
  type BreakdownChild,
} from './subtask-progress';

/** 只带"判断撤销"需要的两个字段 —— 逼着调用方不用凑一个完整 Task */
const child = (batch: string | null, createdAt: string): BreakdownChild => ({
  breakdownBatch: batch,
  createdAt,
});

const task = (status: TaskStatus) => ({ status });

describe('subtaskProgress', () => {
  it('没有子任务：不谈进度', () => {
    expect(subtaskProgress([])).toEqual({ total: 0, done: 0, ratio: 0, allDone: false });
  });

  it('2/5 这种数法来自"完成的条数 / 总条数"', () => {
    const progress = subtaskProgress([
      task(TaskStatus.Done),
      task(TaskStatus.Done),
      task(TaskStatus.Todo),
      task(TaskStatus.Todo),
      task(TaskStatus.Todo),
    ]);
    expect(progress.done).toBe(2);
    expect(progress.total).toBe(5);
    expect(progress.ratio).toBeCloseTo(0.4);
    expect(progress.allDone).toBe(false);
  });

  it('只有全部完成才算 allDone —— 半途不算"做完了"', () => {
    const progress = subtaskProgress([task(TaskStatus.Done), task(TaskStatus.Done)]);
    expect(progress.allDone).toBe(true);
  });
});

describe('desiredParentStatus', () => {
  it('没有子任务时不动父任务', () => {
    expect(desiredParentStatus(task(TaskStatus.Todo), [])).toBeNull();
  });

  it('全部子任务完成 → 父任务完成', () => {
    expect(desiredParentStatus(task(TaskStatus.Todo), [task(TaskStatus.Done)])).toBe(
      TaskStatus.Done,
    );
  });

  it('已经完成的父任务再被取消一个子任务 → 打回待办', () => {
    expect(desiredParentStatus(task(TaskStatus.Done), [task(TaskStatus.Todo)])).toBe(
      TaskStatus.Todo,
    );
  });
});

describe('undoableBreakdown（撤销拆解要撤哪一批）', () => {
  it('全是手写步骤（没有批次）→ 没有可撤销的拆解', () => {
    expect(undoableBreakdown([child(null, '2026-10-12T10:00:00.000Z')])).toBeNull();
  });

  it('一条都没有 → null', () => {
    expect(undoableBreakdown([])).toBeNull();
  });

  it('一次拆解：整批都在，条数就是这批的条数', () => {
    const res = undoableBreakdown([
      child('bd_1', '2026-10-12T10:00:00.000Z'),
      child('bd_1', '2026-10-12T10:00:00.000Z'),
      child('bd_1', '2026-10-12T10:00:00.000Z'),
    ]);
    expect(res).toEqual({ batch: 'bd_1', count: 3 });
  });

  it('⭐ 拆过两次 → 只撤最近那一次（用户说的是"刚做的那一下"）', () => {
    const res = undoableBreakdown([
      child('bd_old', '2026-10-10T10:00:00.000Z'),
      child('bd_old', '2026-10-10T10:00:00.000Z'),
      child('bd_new', '2026-10-12T10:00:00.000Z'),
    ]);
    expect(res).toEqual({ batch: 'bd_new', count: 1 });
  });

  it('⭐ 手写加进去的步骤不算进批次 —— 撤销拆解不该顺手删掉它们', () => {
    const res = undoableBreakdown([
      child('bd_1', '2026-10-12T10:00:00.000Z'),
      child(null, '2026-10-12T11:00:00.000Z'),
      child('bd_1', '2026-10-12T10:00:00.000Z'),
    ]);
    expect(res).toEqual({ batch: 'bd_1', count: 2 });
  });

  it('删掉几条之后，剩下的仍然能被整批撤销', () => {
    const res = undoableBreakdown([child('bd_1', '2026-10-12T10:00:00.000Z')]);
    expect(res).toEqual({ batch: 'bd_1', count: 1 });
  });
});
