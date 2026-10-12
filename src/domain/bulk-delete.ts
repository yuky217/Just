/**
 * 批量删除的撤销凭据。
 *
 * 为什么删除要"返回"点东西：撤销不是"把删除反过来做一遍"——
 * 反过来做需要知道**当时删掉了什么、它们原本挂在哪**，而这些信息删完就没了。
 * 所以删除这一步必须把自己做过的事记录下来交回界面，
 * 界面拿着它才可能在几秒后说"刚才那一下不算"。
 *
 * ⭐ 这里只记**标识与关系**，不记整条数据：任务本身还在库里
 * （软删只是写了 deleted_at），撤销要的是把它放回来，不是把它重新造一遍。
 */

/** 撤销删除任务 */
export interface TaskDeleteUndo {
  kind: 'tasks';
  /** 这次被删掉的任务 id */
  ids: readonly string[];
  /**
   * 撤销时要重新挂回父任务的子任务。
   *
   * 删父任务走的是 `detachSubtasks`（解除关系，不是删）—— 删一条不该
   * 连带删掉用户拆出来的步骤。但撤销的语义是"回到删除前"，
   * 那时这些步骤是挂着的，所以关系得记下来，否则撤销出来的父子是散的。
   */
  parentLinks: readonly { id: string; parentId: string }[];
  /**
   * 这次删除发生的时刻（ISO）。
   *
   * 撤销打卡记录时要拿它当下界：那一列分不清"用户自己撤掉某天"和
   * "删任务时连带软删"，没有这个时刻，撤销就会把以前主动撤掉的打卡也复活。
   */
  checkinSince: string;
}

/** 撤销删除想法 */
export interface IdeaDeleteUndo {
  kind: 'ideas';
  ids: readonly string[];
}

export type DeleteUndo = TaskDeleteUndo | IdeaDeleteUndo;

/** 界面文案要用的是"删了几条"，不是凭据长什么样 */
export function undoCount(undo: DeleteUndo): number {
  return undo.ids.length;
}
