import { TaskStatus, TimeAttribute } from './enums';
import type { Task } from './task';

/**
 * 一条任务"在界面上该是什么样"—— 日历、列表、专注选择器共用这一份判断。
 *
 * 为什么要有这一层：
 * 事情有两种"过了时间"，把它们混在一起处理必做错（这是成熟产品早就分开的两件事）：
 *
 * - **截止型**（`deadline`，有 ddl）过期 = **欠着**。作业没交还是没交，
 *   时间过了它不会自己消失。这种要显眼，因为它就是"该做还没做"。
 * - **固定型**（`fixed`，开会/上课这类占据一段时间的事）过期 = **这件事已经过去了**。
 *   你不会去补开上周三的会。这种要弱化，否则列表会永远堆着一堆"已经没意义的过去"。
 *
 * 还有一条是项目的铁律：**时间过了绝不自动完成**。这里只回答"看起来是什么样"，
 * 不返回、也不写入任何状态 —— 状态只由用户的明确动作改变。
 */

/** 固定型任务没给结束时，按半小时估它占用的时长 */
export const DEFAULT_EVENT_MINUTES = 30;

export type TaskDisplayState =
  /** 已完成（用户明确勾的） */
  | 'done'
  /** 截止型且已过 ddl —— 欠着的 */
  | 'overdue'
  /** 固定型且已过 —— 这段时间已经过去了 */
  | 'missed'
  /** 正在这段时间里 */
  | 'active'
  /** 有安排但还没到 */
  | 'upcoming'
  /** 没有任何时间（还在待办里） */
  | 'unscheduled';

/** 任务占据的那段时间（毫秒时间戳） */
export interface TaskWindow {
  /** 开始；只有截止的事为 null */
  start: number | null;
  /** 这段的结束 */
  end: number;
}

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * 任务的时间窗。
 *
 * 有开始时刻的按"一段"算（结束缺省 = 开始 + 半小时）；
 * 只有截止时刻的按"一个点"算（start 为 null，end = 那个点）。
 * 两者都没有 → null，也就是"待规划"，日历上没有它。
 */
export function taskWindow(task: Pick<Task, 'time'>): TaskWindow | null {
  const start = parse(task.time.startAt);
  const end = parse(task.time.endAt);
  const due = parse(task.time.dueAt);

  if (start !== null) {
    return { start, end: Math.max(end ?? start + DEFAULT_EVENT_MINUTES * 60_000, start) };
  }
  if (due !== null) return { start: null, end: due };
  return null;
}

/** 是不是"截止型"：有 ddl 优先算截止型，否则看时间属性 */
function isDeadlineLike(task: Pick<Task, 'time'>, window: TaskWindow): boolean {
  if (task.time.attribute === TimeAttribute.Deadline) return true;
  // 老数据里 attribute 可能没跟上（只有 dueAt），按字段兜底判
  return window.start === null && task.time.dueAt != null;
}

export function taskDisplayState(task: Pick<Task, 'status' | 'time'>, now: Date = new Date()): TaskDisplayState {
  if (task.status === TaskStatus.Done) return 'done';

  const window = taskWindow(task);
  if (!window) return 'unscheduled';

  const t = now.getTime();
  if (isDeadlineLike(task, window)) return t > window.end ? 'overdue' : 'upcoming';

  if (window.start !== null && t < window.start) return 'upcoming';
  return t <= window.end ? 'active' : 'missed';
}

/**
 * 此刻是否"正在做这件事"。
 * 专注选择器用它挑默认项 —— 时间表上正好有安排的那件，就是最该继续的那件。
 */
export function isActiveNow(task: Pick<Task, 'status' | 'time'>, now: Date = new Date()): boolean {
  return taskDisplayState(task, now) === 'active';
}

/**
 * 界面上该怎么弱化。返回的是"要不要当过去处理"，不回传任何样式（样式归组件）。
 * 完成与已过去的固定型都弱化，欠着的截止型不弱化。
 */
export function isMuted(state: TaskDisplayState): boolean {
  return state === 'done' || state === 'missed';
}

/**
 * 这条任务是不是**还没做完** —— 也就是"欠着的那几件"里的一个。
 *
 * 为什么要单独有这个函数：同一条判断（`status !== Done`）此前散在
 * **日历页的 `openCountsByDay`**（月历圆点的深浅）和
 * **`widget-days` 的按天分桶**（周卡/月卡）两处；周视图表头那颗点也要用它，
 * 就变成三处各写一遍。月历的深浅口径一旦要动（比如"过了时间的截止也算欠着"），
 * 漏改任何一处就会出现"月历说还欠着、周视图说全干完了"。
 *
 * ⚠️ 它**只回答完成态**，不看时间 —— "已经过去"是另一回事（`isMuted`），
 * 上周三的会没勾选，按这条仍然算"没做完"，因为项目铁律是
 * **时间过了绝不自动完成**。
 */
export function isOpenTask(task: Pick<Task, 'status'>): boolean {
  return task.status !== TaskStatus.Done;
}
