import { addDays, startOfDay } from 'date-fns';

import { dayShapes, type DayDot, type DayMarks } from '@/domain/calendar-shape';
import { coursesOnDate, type Course, type Term } from '@/domain/course';
import { TaskStatus } from '@/domain/enums';
import type { CalEvent } from '@/domain/event';
import { taskAnchor, type Task } from '@/domain/task';
import { dayKeyOf, toDayKey } from '@/utils/datetime';

/**
 * 小组件（周卡 / 月卡）的数据口径。
 *
 * 为什么单独一个文件：日历页的按天分桶散在组件的 useMemo 里（`countsByDay`、
 * `examsByDay` 那一坨），小组件要的是**同一套形状语言、不同的取数路径**
 * （快照是前台一次算好写进文件的，不走日历页的按窗口查询）。收在这里
 * 纯函数化，周卡、月卡和它们的测试用的是同一份。
 *
 * 口径对齐（改哪边都要想着另一边）：
 * - 任务 → `taskAnchor` 落本地日（与日历页 countsByDay 同一条）；
 * - 考试 → `startAt` 落本地日（与 examsByDay 同一条）；
 * - 课   → `coursesOnDate`（与日/周视图同一份课表换算）；
 * - 圆点 → `dayShapes`（先课→再考试→最后任务，任务未完成优先，名额 3）。
 *
 * **刻意不含纪念日**：`dayShapes` 的形状语言只有课/考试/任务三种，
 * 纪念日没有"要不要动手"的完成语义，硬塞进去要么骗形状要么加第四种 ——
 * 都不做。小组件是扫一眼的地方，生日的提醒有日历和月历下拉清单兜着。
 */

/** 月卡 / 周卡上的一格 */
export interface WidgetDayCell {
  /** 'YYYY-MM-DD' 本地日 */
  key: string;
  /** 格子里写的几号 */
  dayOfMonth: number;
  /** 属不属于目标月份（月卡网格前后补位的格子是 false） */
  inMonth: boolean;
  isToday: boolean;
  /** 那天的任务总数（含已完成） */
  tasks: number;
  /** 其中还没做完的 */
  openTasks: number;
  courses: number;
  exams: number;
  /** 月历同一套形状语言，最多 `MAX_DAY_DOTS` 个 */
  dots: DayDot[];
}

export interface WidgetDaysInput {
  tasks: readonly Task[];
  events: readonly CalEvent[];
  courses: readonly Course[];
  term: Term | null;
  /** 从这一天开始连数 `days` 天（传入值取本地零点） */
  from: Date;
  days: number;
  /**
   * 哪个月算"本月"（判 inMonth 用）。周卡传 null/不传 = 每格都算"在内"。
   */
  month?: Date | null;
  now?: Date;
}

export function collectWidgetDays(input: WidgetDaysInput): WidgetDayCell[] {
  const now = input.now ?? new Date();
  const todayKey = toDayKey(now);
  const monthKey = input.month ? toDayKey(input.month).slice(0, 7) : null;

  const taskCounts = new Map<string, { total: number; open: number }>();
  for (const task of input.tasks) {
    const key = dayKeyOf(taskAnchor(task));
    if (!key) continue;
    const bucket = taskCounts.get(key) ?? { total: 0, open: 0 };
    bucket.total += 1;
    if (task.status !== TaskStatus.Done) bucket.open += 1;
    taskCounts.set(key, bucket);
  }

  const examCounts = new Map<string, number>();
  for (const event of input.events) {
    if (event.deletedAt) continue;
    const key = dayKeyOf(event.startAt);
    if (!key) continue;
    examCounts.set(key, (examCounts.get(key) ?? 0) + 1);
  }

  const base = startOfDay(input.from);
  const count = Math.max(0, Math.trunc(input.days));
  const cells: WidgetDayCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(base, i);
    const key = toDayKey(date);
    const courses = input.term ? coursesOnDate(input.courses, date, input.term).length : 0;
    const bucket = taskCounts.get(key);
    const total = bucket?.total ?? 0;
    const openTasks = bucket?.open ?? 0;
    const exams = examCounts.get(key) ?? 0;
    const marks: DayMarks = { courses, exams, openTasks };
    cells.push({
      key,
      dayOfMonth: date.getDate(),
      inMonth: monthKey === null || key.slice(0, 7) === monthKey,
      isToday: key === todayKey,
      tasks: total,
      openTasks,
      courses,
      exams,
      dots: dayShapes(total, marks),
    });
  }
  return cells;
}
