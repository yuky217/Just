import type { Task } from '@/domain/task';

/**
 * 拖拽变子任务的落库方案（纯函数，便于单测）。
 *
 * 把"能不能挂、挂完子任务怎么归"这件事从 store 里抽出来，原因有二：
 * 1. 这条规则是产品定论（2026-10-15）：**只一层**，不能把一条挂到别人的子任务下面；
 * 2. store 那一层会牵扯 react-native，在 vitest 里跑不起来，纯逻辑必须能单独测。
 *
 * 调用方（makeSubtask）照着方案写库：
 * - 设 parentId = plan.parentId；
 * - plan.reparentIds（被拖那条原本带的孩子）退回顶层，避免三层嵌套。
 */
export interface NestPlan {
  /** 挂到这条下面 */
  parentId: string;
  /** 被拖那条原本的子任务 id（要退回顶层，先一层原则） */
  reparentIds: readonly string[];
}

/**
 * 计算把 child 挂到 parent 下的方案。返回 null = 不允许。
 *
 * 非法情形：
 * - child 和 parent 是同一条（不能挂自己）；
 * - parent 自己已经是某条任务的子任务（不允许套娃，本 app 的子任务只有一层）。
 *
 * `childChildren` 是 child 当前挂着的子任务，方案里原样交回去让调用方退回顶层。
 */
export function planNest(child: Task, parent: Task, childChildren: readonly Task[]): NestPlan | null {
  if (child.id === parent.id) return null;
  if (parent.parentId) return null;
  return {
    parentId: parent.id,
    reparentIds: childChildren.map((task) => task.id),
  };
}
