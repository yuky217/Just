import { describe, expect, it } from 'vitest';

import { planNest } from '@/domain/nest';
import { createSubtask, createTask } from '@/domain/factory';
import { TaskKind } from '@/domain/enums';

/**
 * planNest 是「拖拽变子任务」的核心判据（纯函数，能在 vitest 里跑，不牵扯 react-native）。
 * 它锁死两条产品定论（2026-10-15）：
 *   - 不能挂到自己的子任务下（只一层，不允许套娃）；
 *   - 被拖那条原本带的孩子要退回顶层。
 * 这几条测例是在「验牙」：把规则改回去，测试应当变红。
 */
function topTask(title: string) {
  return createTask({ title, kind: TaskKind.Execution });
}

describe('planNest（拖拽变子任务的落库方案）', () => {
  it('合法：顶层任务挂到另一条顶层任务下，且交回自己原有的孩子', () => {
    const parent = topTask('parent');
    const child = topTask('child');
    const grandchild = createSubtask(child.id, 'grandchild');

    const plan = planNest(child, parent, [grandchild]);
    expect(plan).not.toBeNull();
    expect(plan?.parentId).toBe(parent.id);
    // 先一层：child 原本带的 grandchild 要退回顶层
    expect(plan?.reparentIds).toEqual([grandchild.id]);
  });

  it('非法：不能挂到自己下', () => {
    const task = topTask('task');
    const plan = planNest(task, task, []);
    expect(plan).toBeNull();
  });

  it('非法：不能挂到非顶层任务下（套娃）', () => {
    const top = topTask('top');
    const mid = createSubtask(top.id, 'mid'); // mid 是 top 的子任务
    const other = topTask('other');

    const plan = planNest(other, mid, []);
    expect(plan).toBeNull();
  });

  it('被拖那条没有孩子时，方案里 reparentIds 为空', () => {
    const parent = topTask('parent');
    const child = topTask('child');
    const plan = planNest(child, parent, []);
    expect(plan?.reparentIds).toEqual([]);
  });
});
