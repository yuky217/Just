import { TaskStatus } from './enums';
import type { Task } from './task';

/** 判断"能不能整批撤销"只需要这三个字段，别逼调用方凑出一个完整 Task */
export type BreakdownChild = Pick<Task, 'breakdownBatch' | 'createdAt'>;

/**
 * 能撤销的那一次拆解。
 *
 * 一群子任务里可能混着好几个批次（拆过两次、中间还手写了两条），
 * 撤销的对象必须是**最近那一次** —— 用户说"撤销拆解"，说的是刚做的那一下。
 *
 * 只认还带着批次标记的行：手写一条条加进去的步骤没有批次，
 * 撤销拆解不该顺手把它们删掉。
 */
export function undoableBreakdown(
  children: ReadonlyArray<BreakdownChild>,
): { batch: string; count: number } | null {
  let batch: string | null = null;
  let at = '';
  for (const child of children) {
    if (!child.breakdownBatch) continue;
    if (!batch || child.createdAt > at) {
      batch = child.breakdownBatch;
      at = child.createdAt;
    }
  }
  if (!batch) return null;
  return { batch, count: children.filter((child) => child.breakdownBatch === batch).length };
}

/**
 * 子任务进度（纯逻辑）。
 *
 * 设计取舍：**父任务的完成态由子任务决定，但只在"全部子任务都完成"时才自动完成**。
 * 这与项目里"完成只由明确的勾选触发"的规矩一致 —— 勾最后一个子任务就是那个明确动作；
 * 反过来，只要取消掉一个子任务，父任务就退回待办（不会留下"做完了但还有子任务没做"的脏状态）。
 *
 * 不做递归：子任务只能挂一层（见 domain/task.ts 的 parentId 注释）。
 */

export interface SubtaskProgress {
  total: number;
  done: number;
  /** 0..1，供进度条用 */
  ratio: number;
  /** 是否全部子任务都已完成（total > 0 才有意义） */
  allDone: boolean;
}

export function subtaskProgress(
  children: ReadonlyArray<Pick<Task, 'status'>>,
): SubtaskProgress {
  const total = children.length;
  const done = children.filter((c) => c.status === TaskStatus.Done).length;
  return {
    total,
    done,
    ratio: total === 0 ? 0 : done / total,
    allDone: total > 0 && done === total,
  };
}

/**
 * 根据子任务状态算出父任务应该处于的完成态。
 *
 * 返回 null = "不改父任务"（没有子任务、或还没全完成 —— 半途不该动父任务的状态）。
 */
export function desiredParentStatus(
  parent: Pick<Task, 'status'>,
  children: ReadonlyArray<Pick<Task, 'status'>>,
): TaskStatus | null {
  const progress = subtaskProgress(children);
  if (progress.total === 0) return null;

  if (progress.allDone) {
    return parent.status === TaskStatus.Done ? null : TaskStatus.Done;
  }
  // 全部完成的父任务被"取消一个子任务"打回待办
  return parent.status === TaskStatus.Done ? TaskStatus.Todo : null;
}
