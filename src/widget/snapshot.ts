import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { format, startOfWeek } from 'date-fns';

import { describeSlotTiming, nextCourse, type CourseSlot } from '@/domain/course';
import { summarizeCheckins } from '@/domain/checkins';
import { describeClock, periodSpan } from '@/domain/timetable';
import { isAllDay, pendingUntil, taskAnchor, type Task } from '@/domain/task';
import { TaskStatus } from '@/domain/enums';
import { monthGridDays } from '@/domain/calendar-window';
import { collectWidgetDays, type WidgetDayCell } from '@/domain/widget-days';
import { toDayKey } from '@/utils/datetime';
import { useAppStore } from '@/state/app-store';

/**
 * 小组件数据快照。
 *
 * 为什么是「文件」而不是让 widget handler 现读数据库：
 * 小组件由 launcher 进程绘制，系统刷新时唤起的是一个**没有界面的 App 进程**，
 * 不保证 expo-sqlite 已初始化。所以 App 在前台/数据变动时把算好的快照写进文件，
 * widget handler 只读这份文件 —— 零依赖我们的 DB，也最快。
 * （见 docs/小组件实施规划.md 风险 1）
 *
 * 2026-10-11 扩量：新增 今天时间线 / 周卡 / 月卡 / 习惯打卡 四块数据。
 * 老快照文件缺这些字段时按空补齐（readWidgetSnapshot 的 merge 兜底），
 * 不会让已装的第一批组件白屏。
 */

export interface NextDeadline {
  /** "14:00" */
  time: string;
  title: string;
}

export interface NextClassInfo {
  title: string;
  /** "正在上 · 10:00–11:40" / "25 分钟后 · 10:00–11:40" */
  headline: string;
  place: string | null;
}

/** 「今天」卡时间线里的一行 */
export interface WidgetTodayItem {
  /** "14:00"，全天 = "全天" */
  time: string;
  title: string;
}

/** 形状/日期格子类型从 domain 直接出口，界面（小组件与预览）共用一份 */
export type { WidgetDayCell } from '@/domain/widget-days';
export type { DayDot } from '@/domain/calendar-shape';

/** 习惯卡里的一行 */
export interface WidgetHabitInfo {
  id: string;
  title: string;
  /** 今天打了没有（小组件上能不能点亮的唯一依据） */
  doneToday: boolean;
  /** 连续天数（打卡卡片的正反馈） */
  streak: number;
}

export interface WidgetSnapshot {
  todayCount: number;
  nextDeadline: NextDeadline | null;
  nextClass: NextClassInfo | null;
  /** 今天的事（带时刻的最多 4 条，按锚点排序）——「今天」卡的时间线 */
  todayItems: WidgetTodayItem[];
  /** 周卡：本周 7 天（周一起） */
  week: WidgetDayCell[] | null;
  /** 月卡：整张 6×7 网格 */
  month: { title: string; days: WidgetDayCell[] } | null;
  /** 习惯卡：最多 5 条 */
  habits: WidgetHabitInfo[];
  updatedAt: string;
}

const snapshotFile = () => new File(Paths.document, 'widget-snapshot.json');

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatHHMM = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** 习惯卡上限：一屏扫一眼的地方，5 条再多就该滚进 App 看 */
export const WIDGET_HABIT_LIMIT = 5;

/**
 * 现算全部小组件的数据。
 * 纯函数（读 app-store 现值），复用现有 domain 口径，不另造。
 */
export function computeWidgetSnapshot(): WidgetSnapshot {
  const state = useAppStore.getState();
  const now = new Date();

  // 今天：store.today 已是"今天开始/到期/进行中"的顶层任务；按 active 计数
  const items = state.today.filter((t: Task) => t.status !== TaskStatus.Done);
  const todayCount = items.length;

  // 下一个截止：今天里时间仍在将来、且最早的那一件
  let nextDeadline: NextDeadline | null = null;
  let bestMs = Infinity;
  for (const t of items) {
    // ⭐ 全天要看 endAt（当天 23:59:59）而不是 startAt，否则"今天全天"的事
    // 永远算不上"下一个截止"（00:00 永远在过去）。口径收在 domain.pendingUntil。
    const iso = pendingUntil(t.time);
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (ms < now.getTime()) continue; // 只看还没到的
    if (ms < bestMs) {
      bestMs = ms;
      // 全天没有时刻可显示：写"00:00"等于谎报
      nextDeadline = { time: isAllDay(t.time) ? '全天' : formatHHMM(new Date(ms)), title: t.title };
    }
  }

  // 今天的时间线：带锚点的按锚点排，全天放最前；只取 4 条，更多请开 App
  const todayItems: WidgetTodayItem[] = items
    .filter((t) => taskAnchor(t) != null)
    .sort((a, b) => (taskAnchor(a) ?? '').localeCompare(taskAnchor(b) ?? ''))
    .slice(0, 4)
    .map((t) => ({
      time: isAllDay(t.time) ? '全天' : formatHHMM(new Date(taskAnchor(t)!)),
      title: t.title,
    }));

  // 下一节课：复用首页同一条口径
  let nextClass: NextClassInfo | null = null;
  if (state.term && state.courses.length) {
    const slot: CourseSlot | null = nextCourse(state.courses, state.term, now);
    if (slot) {
      const timing = describeSlotTiming(slot, now);
      const span = periodSpan(state.term.periods, slot.session.startPeriod, slot.session.endPeriod);
      const clock = span ? `${describeClock(span.start)}–${describeClock(span.end)}` : '';
      const place = slot.session.location ?? slot.course.location ?? null;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const minutesUntil = slot.start - nowMinutes;
      const headline =
        timing === '正在上'
          ? `正在上 · ${clock}`
          : minutesUntil > 0 && minutesUntil <= 120
            ? `${minutesUntil} 分钟后 · ${clock}`
            : `${timing} ${clock}`;
      nextClass = { title: slot.course.title, headline, place };
    }
  }

  // 周卡 / 月卡：同一个收集器，不同的窗口（口径见 domain/widget-days）
  const week = collectWidgetDays({
    tasks: state.tasks,
    events: state.events,
    courses: state.courses,
    term: state.term,
    from: startOfWeek(now, { weekStartsOn: 1 }),
    days: 7,
    now,
  });
  const month = {
    title: format(now, 'yyyy年M月'),
    days: collectWidgetDays({
      tasks: state.tasks,
      events: state.events,
      courses: state.courses,
      term: state.term,
      from: monthGridDays(now)[0],
      days: monthGridDays(now).length,
      month: now,
      now,
    }),
  };

  // 习惯卡：doneToday 是"能不能点亮"的唯一依据，streak 是正反馈
  const keysByTask = new Map<string, string[]>();
  for (const record of state.checkins) {
    const bucket = keysByTask.get(record.taskId);
    if (bucket) bucket.push(record.dayKey);
    else keysByTask.set(record.taskId, [record.dayKey]);
  }
  const habits: WidgetHabitInfo[] = state.habits.slice(0, WIDGET_HABIT_LIMIT).map((habit) => {
    const info = summarizeCheckins(keysByTask.get(habit.id) ?? [], now);
    return { id: habit.id, title: habit.title, doneToday: info.doneToday, streak: info.current };
  });

  return {
    todayCount,
    nextDeadline,
    nextClass,
    todayItems,
    week,
    month,
    habits,
    updatedAt: now.toISOString(),
  };
}

/** 把当前快照写进文件（仅 Android 有意义；失败静默，widget 只是加分项） */
export async function writeWidgetSnapshot(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const snap = computeWidgetSnapshot();
    const file = snapshotFile();
    await file.write(JSON.stringify(snap));
  } catch {
    // 写快照失败不该影响主流程
  }
}

/** 读快照；文件缺失/损坏时返回空快照，widget 显示空态 */
export async function readWidgetSnapshot(): Promise<WidgetSnapshot> {
  if (Platform.OS !== 'android') return emptySnapshot();
  try {
    const raw = await snapshotFile().text();
    const parsed = JSON.parse(raw) as Partial<WidgetSnapshot>;
    return { ...emptySnapshot(), ...parsed };
  } catch {
    return emptySnapshot();
  }
}

const emptySnapshot = (): WidgetSnapshot => ({
  todayCount: 0,
  nextDeadline: null,
  nextClass: null,
  todayItems: [],
  week: null,
  month: null,
  habits: [],
  updatedAt: '',
});

/** 习惯打卡的无界面切换（小组件点击处理用）：今天打过就撤、没打就打 */
export async function toggleHabitToday(taskId: string, day: Date = new Date()): Promise<boolean> {
  try {
    const { checkinRepository } = await import('@/data/repositories/checkin-repository');
    const todayKey = toDayKey(day);
    const existing = await checkinRepository.getByDay(taskId, todayKey);
    if (existing) await checkinRepository.undo(taskId);
    else await checkinRepository.checkIn(taskId);
    return true;
  } catch {
    return false;
  }
}
