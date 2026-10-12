import { CompletionRule, RepeatFreq, TaskKind, TaskStatus } from './enums';
import type { RepeatRule, Task } from './task';

/**
 * 「转为习惯」——把一条已有的任务改成习惯。
 *
 * ## 先分清三个词，它们不是一回事
 *
 * - **习惯**：一件要**反复做**的事（每周跑 3 次）。它是任务的一种
 *   （`TaskKind.Habit`），自带节奏：这期做了几次，下期重新开始。
 * - **打卡**：记录「今天做了没有」的那个**动作**，落点是 `task_checkins` 表。
 *   它只是一笔事实，本身不构成任何东西。
 * - **转为习惯**：一次**操作**，把执行型 / 日程型任务改成习惯。
 *
 * ⭐ **打卡是手段，转为习惯是操作。不要混。**
 * 混了就会写出「转成打卡」这种说法 —— 而用户转完之后要的是"每周跑三次"这件事，
 * 打卡只是它之后每天要做的一个动作。界面上因此只说「转为习惯」，
 * 「打卡」留给真正指那个动作的地方（按钮、记录、撤销今天的打卡）。
 *
 * ## 为什么需要这一步
 *
 * 任务和习惯**看起来像、语义上是两件事**：
 * - 任务是**终点型**：勾了就结束，从列表里消失。
 * - 习惯是**过程型**：每天重置，今天做过明天还得来。
 *
 * 所以「转为习惯」不是换个显示方式，而是**换判定域**：
 * 从 `task.status`（一次性状态）换到打卡记录（每日事实）。
 * 转换要动的字段因此是固定的那几项：类型、完成判定、重复规则、次数目标，
 * 以及把状态拉回待办（完成与否从此由打卡记录说话）。
 *
 * 刻意**不动**的是 `time` —— 用户可能真的想"每天早上 7 点跑步"，
 * 擅自清掉时间会把这种真实意图毁掉。要清，让用户自己在详情页清。
 *
 * 纯函数，不碰数据库：写库由 state 层收口。
 */

export type HabitCadence = 'daily' | 'weekly' | 'monthly';

export interface ConvertToHabitInput {
  cadence: HabitCadence;
  /** 目标次数（每周 / 每月 N 次）。每天固定 1 次，传什么都不看 */
  targetOccurrences: number;
  /**
   * 任务原本已经完成过时，要不要把它算作"今天已经做过一次"。
   * 默认 true —— 用户已经做过的事不该因为一次转换就从记录里消失。
   */
  countExistingCompletion?: boolean;
}

export interface HabitConversionPlan {
  patch: Partial<Task>;
  /** 转换后是否补一条今天的打卡记录 */
  seedCheckin: boolean;
  /**
   * 转为习惯后会丢什么 —— 界面必须如实说出来，不能悄悄丢。
   * 措辞一律「转为习惯后…」，因为这是**这一步操作**的代价，不是习惯本身的属性。
   */
  warnings: string[];
  /** 一句确认文案 */
  message: string;
}

/** 想法型是"待在想法库、不催办"的东西，不该被转成习惯 */
export function canConvertToHabit(task: Pick<Task, 'kind' | 'completion'>): boolean {
  if (task.kind === TaskKind.Idea) return false;
  // 已经是频率型习惯了，没什么可转的
  if (task.completion === CompletionRule.Frequency) return false;
  return true;
}

/** 频率选项的中文短描述，界面直接用 */
export function describeCadence(cadence: HabitCadence, targetOccurrences: number): string {
  const target = Math.max(1, Math.floor(targetOccurrences || 1));
  if (cadence === 'daily') return '每天 1 次';
  if (cadence === 'weekly') return `每周 ${target} 次`;
  return `每月 ${target} 次`;
}

/**
 * 界面上能直接点的几个节奏（习惯页「新建」与任务详情页「转为习惯」共用）。
 *
 * 刻意不做"频率 + 次数"的二级表单：这一步唯一要选的是频率，而常见值就这么几个；
 * 想改次数去详情页的「目标」卡。**两处必须给同一组选项** —— 各写一份的话，
 * 迟早出现"'每周 5 次'在习惯页有、在任务页没有"这种对不上的事。
 */
export const HABIT_CADENCE_PRESETS: ReadonlyArray<{
  label: string;
  cadence: HabitCadence;
  target: number;
}> = [
  { label: '每天 1 次', cadence: 'daily', target: 1 },
  { label: '每周 3 次', cadence: 'weekly', target: 3 },
  { label: '每周 5 次', cadence: 'weekly', target: 5 },
  { label: '每月 10 次', cadence: 'monthly', target: 10 },
];

export function buildHabitConversion(
  task: Pick<Task, 'kind' | 'completion' | 'repeat' | 'targetMinutes' | 'status'>,
  input: ConvertToHabitInput,
): HabitConversionPlan {
  const target = Math.max(1, Math.floor(input.targetOccurrences || 1));

  const repeat: RepeatRule =
    input.cadence === 'daily'
      ? { freq: RepeatFreq.Daily, interval: 1 }
      : input.cadence === 'weekly'
        ? { freq: RepeatFreq.Weekly, interval: 1 }
        : { freq: RepeatFreq.Monthly, interval: 1 };

  const warnings: string[] = [];
  if (task.targetMinutes != null && task.targetMinutes > 0) {
    warnings.push(
      `转为习惯后，原来的「够 ${task.targetMinutes} 分钟」目标不再生效（习惯按打卡次数判定）`,
    );
  }
  if (task.repeat) {
    warnings.push('转为习惯后，原来的重复规则会被换成习惯的频率');
  }

  return {
    patch: {
      kind: TaskKind.Habit,
      completion: CompletionRule.Frequency,
      repeat,
      targetOccurrences: input.cadence === 'daily' ? 1 : target,
      // 时长目标必须清掉：一个任务只允许一套完成判定，留着两套必然打架
      targetMinutes: null,
      // 完成与否从此由打卡记录回答，先归零，再交给对账收敛
      status: TaskStatus.Todo,
      completedAt: null,
    },
    // 注意是 `!== false` 而不是 `Boolean(...)`：
    // 不传（undefined）要按**默认开启**处理，写成 Boolean 会把默认值反过来。
    seedCheckin: input.countExistingCompletion !== false && task.status === TaskStatus.Done,
    warnings,
    message: `已转为习惯：${describeCadence(input.cadence, target)}`,
  };
}
