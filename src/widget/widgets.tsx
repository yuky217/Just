import { Platform } from 'react-native';
import {
  FlexWidget,
  TextWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  type WidgetRepresentation,
} from 'react-native-android-widget';

import { WEEKDAY_LABELS } from '@/domain/course';
import { parseDayKey } from '@/utils/datetime';
import { useAppStore } from '@/state/app-store';
import {
  computeWidgetSnapshot,
  readWidgetSnapshot,
  toggleHabitToday,
  writeWidgetSnapshot,
  type DayDot,
  type WidgetDayCell,
  type WidgetSnapshot,
} from './snapshot';

/** 五个独立的小组件，用户可分别添加到桌面（2026-10-11 扩量：+ 周/月/习惯） */
const WIDGET_NAMES = ['Today', 'NextClass', 'Week', 'Month', 'Habit'] as const;
type WidgetName = (typeof WIDGET_NAMES)[number];

/** 习惯打卡行的动作名。handler 里按它认点击（见 setupWidgets） */
const TOGGLE_HABIT_ACTION = 'just.toggleHabit';

/** 配色与 App 主题一致（theme.ts 的暖调近黑近白，极简无彩色强调） */
const PALETTE = {
  light: { bg: '#FAF9F7', text: '#1B1A18', secondary: '#6D6A63' },
  dark: { bg: '#111110', text: '#F2F0EB', secondary: '#B5B1A8' },
} as const;

/**
 * 小组件不支持 `'transparent'` 这个关键字（ColorProp 只认 hex）——
 * "空心的圆"用"和底色一致的填充 + 描边"来表达，视觉上一模一样。
 * 卡片底色两种主题都不透明，所以这么做没有副作用。
 *
 * 颜色类型收成 `#${string}`（即库里的 HexColor）：写成裸 string 会在
 * 每一个 style 上被判不可赋值。
 */
type Palette = { bg: `#${string}`; text: `#${string}`; secondary: `#${string}` };

/*
 * 形状语言与日历完全同一套（domain/calendar-shape）：
 * 课 = 空心圆 · 考试 = 实心方块 · 任务 = 实心圆（未完成深 / 已完成浅）。
 * 小组件是月历圆点换了个地方 —— 用户不需要再学一遍。
 */
function ShapeDot({ dot, c }: { dot: DayDot; c: Palette }) {
  if (dot.kind === 'course') {
    return (
      <FlexWidget
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: c.secondary,
          backgroundColor: c.bg,
        }}
      />
    );
  }
  if (dot.kind === 'exam') {
    return (
      <FlexWidget style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: c.text }} />
    );
  }
  return (
    <FlexWidget
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: dot.open ? c.text : c.secondary,
      }}
    />
  );
}

/** 星期几的短标签（'一'…'日'）。列是周一起，按 cell 的 key 现算 */
function weekdayShort(key: string): string {
  const date = parseDayKey(key);
  if (!date) return '';
  return WEEKDAY_LABELS[date.getDay()].replace('周', '');
}

function DotsRow({ cell, c }: { cell: WidgetDayCell; c: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 2, height: 7 }}>
      {cell.dots.map((dot, index) => (
        <ShapeDot key={index} dot={dot} c={c} />
      ))}
    </FlexWidget>
  );
}

function WeekCard({ c, snap }: { c: Palette; snap: WidgetSnapshot }) {
  const days = snap.week ?? [];
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="这一周"
      style={{
        flexDirection: 'column',
        padding: 14,
        flexGap: 8,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget style={{ fontSize: 12, color: c.secondary }} text="这一周" />
      {days.length ? (
        <FlexWidget style={{ flexDirection: 'row', flexGap: 4 }}>
          {days.map((cell) => (
            <FlexWidget
              key={cell.key}
              style={{
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center',
                flexGap: 4,
              }}>
              <TextWidget
                style={{ fontSize: 10, color: c.secondary }}
                text={weekdayShort(cell.key)}
              />
              <TextWidget
                style={{
                  fontSize: 14,
                  color: cell.isToday ? c.text : c.secondary,
                  fontWeight: cell.isToday ? 'bold' : 'normal',
                }}
                text={String(cell.dayOfMonth)}
              />
              <DotsRow cell={cell} c={c} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : (
        <TextWidget style={{ fontSize: 13, color: c.secondary }} text="打开 JUST 看看这一周" />
      )}
    </FlexWidget>
  );
}

function MonthCard({ c, snap }: { c: Palette; snap: WidgetSnapshot }) {
  const month = snap.month;
  const days = month?.days ?? [];
  const rows: WidgetDayCell[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="月历"
      style={{
        flexDirection: 'column',
        padding: 14,
        flexGap: 6,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget
        style={{ fontSize: 12, color: c.secondary }}
        text={month?.title ?? '打开 JUST 看看这个月'}
      />
      {rows.map((row, rowIndex) => (
        <FlexWidget key={rowIndex} style={{ flexDirection: 'row', flexGap: 2 }}>
          {row.map((cell) => (
            <FlexWidget
              key={cell.key}
              style={{
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center',
                flexGap: 3,
                paddingVertical: 1,
              }}>
              <TextWidget
                style={{
                  fontSize: 11,
                  // 补位格（上月/下月那几天）用弱色代替透明度 ——
                  // 小组件不支持 opacity，颜色本身就是唯一能表达深浅的手段
                  color: cell.inMonth ? c.secondary : '#C9C6C0',
                  fontWeight: cell.isToday ? 'bold' : 'normal',
                  ...(cell.isToday ? { color: c.text } : {}),
                }}
                text={cell.inMonth ? String(cell.dayOfMonth) : ''}
              />
              <DotsRow cell={cell} c={c} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function HabitCard({ c, snap }: { c: Palette; snap: WidgetSnapshot }) {
  const habits = snap.habits;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="习惯打卡"
      style={{
        flexDirection: 'column',
        padding: 14,
        flexGap: 8,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget style={{ fontSize: 12, color: c.secondary }} text="今天打卡" />
      {habits.length ? (
        habits.map((habit) => (
          // 整行就是打卡按钮：点了在无界面进程里直接落库并重画（见 setupWidgets）
          <FlexWidget
            key={habit.id}
            clickAction={TOGGLE_HABIT_ACTION}
            clickActionData={{ taskId: habit.id }}
            accessibilityLabel={`${habit.title}，${habit.doneToday ? '今天已打卡' : '今天还没打'}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexGap: 8,
              paddingVertical: 2,
            }}>
            <FlexWidget
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor: c.text,
                backgroundColor: habit.doneToday ? c.text : c.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {habit.doneToday ? (
                <TextWidget style={{ fontSize: 10, color: c.bg }} text="✓" />
              ) : null}
            </FlexWidget>
            <TextWidget
              maxLines={1}
              truncate="END"
              style={{ fontSize: 13, color: c.text }}
              text={habit.title}
            />
            <TextWidget
              style={{ fontSize: 10, color: habit.doneToday ? c.text : c.secondary }}
              text={habit.doneToday ? (habit.streak > 1 ? `连续 ${habit.streak} 天` : '打了') : '今天还没打'}
            />
          </FlexWidget>
        ))
      ) : (
        <TextWidget style={{ fontSize: 13, color: c.secondary }} text="还没有习惯，去 JUST 里建一个" />
      )}
    </FlexWidget>
  );
}

function TodayCard({ c, snap }: { c: Palette; snap: WidgetSnapshot }) {
  const deadline = snap.nextDeadline
    ? `下一个 ${snap.nextDeadline.time} ${snap.nextDeadline.title}`
    : '今天没有更多截止';
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="今天概览"
      style={{
        flexDirection: 'column',
        padding: 16,
        flexGap: 6,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget style={{ fontSize: 12, color: c.secondary }} text="今天" />
      <TextWidget
        style={{ fontSize: 18, fontWeight: 'bold', color: c.text }}
        text={`今天 ${snap.todayCount} 件事`}
      />
      <TextWidget style={{ fontSize: 14, color: c.secondary }} text={deadline} />
      {snap.todayItems.map((item, index) => (
        <TextWidget
          key={index}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: c.secondary }}
          text={`${item.time}  ${item.title}`}
        />
      ))}
    </FlexWidget>
  );
}

function NextClassCard({ c, snap }: { c: Palette; snap: WidgetSnapshot }) {
  const sub = snap.nextClass
    ? snap.nextClass.place
      ? `${snap.nextClass.headline} · ${snap.nextClass.place}`
      : snap.nextClass.headline
    : '近期没有课';
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="下一节课"
      style={{
        flexDirection: 'column',
        padding: 16,
        flexGap: 6,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget style={{ fontSize: 12, color: c.secondary }} text="下一节课" />
      <TextWidget
        style={{ fontSize: 18, fontWeight: 'bold', color: c.text }}
        text={snap.nextClass?.title ?? '还没排课'}
      />
      <TextWidget style={{ fontSize: 14, color: c.secondary }} text={sub} />
    </FlexWidget>
  );
}

function buildWidget(name: WidgetName, theme: 'light' | 'dark', snap: WidgetSnapshot) {
  const c = PALETTE[theme];
  switch (name) {
    case 'Today':
      return <TodayCard c={c} snap={snap} />;
    case 'NextClass':
      return <NextClassCard c={c} snap={snap} />;
    case 'Week':
      return <WeekCard c={c} snap={snap} />;
    case 'Month':
      return <MonthCard c={c} snap={snap} />;
    case 'Habit':
      return <HabitCard c={c} snap={snap} />;
  }
}

/** 同时产出 light / dark 两版，由系统按当前主题挑 */
function renderRepresentation(snap: WidgetSnapshot, widgetName: WidgetName): WidgetRepresentation {
  return {
    light: buildWidget(widgetName, 'light', snap),
    dark: buildWidget(widgetName, 'dark', snap),
  };
}

/**
 * 给设置页的实时预览：**同一个组件、同一份快照数据** ——
 * 预览长什么样，放到桌面就是什么样，中间没有第二套渲染代码。
 * 只出浅色版：预览的目的是"看清内容排布"，深浅色跟随系统就好。
 */
export function widgetPreview(name: WidgetName, snap: WidgetSnapshot) {
  return buildWidget(name, 'light', snap);
}

export type { WidgetName };

/**
 * 习惯打卡的无界面落库：点行 → toggle 今天 → 让 store 重算 → 重写快照。
 * DB 是惰性打开的（client.ts），无界面进程里也能走通；走不通就静默放弃，
 * 下次 App 打开时状态照常对齐 —— 最坏结果是"那一下没打上"，不会错打成别的。
 */
async function handleHabitToggle(taskId: string): Promise<void> {
  const ok = await toggleHabitToday(taskId);
  if (!ok) return;
  try {
    // refresh 会做频率任务对账 + 触发订阅推送（所有小组件跟着重画）+ 重写快照。
    // App 活着时它就是用户看到的那次刷新；进程刚被唤起时它顺带把状态初始化好。
    await useAppStore.getState().refresh();
    await writeWidgetSnapshot();
  } catch {
    // 对账/重写失败不回滚打卡本身 —— 打卡已落库，界面下次打开会对齐
  }
}

/**
 * 注册小组件：必须在模块顶层调用（headless task 的注册要在 bundle 加载时就完成，
 * 不能放进 React 组件的 effect —— 系统冷启动刷新 widget 时不会跑 UI 组件）。
 */
export function setupWidgets(): void {
  if (Platform.OS !== 'android') return;

  registerWidgetTaskHandler(async (props) => {
    const { widgetInfo, widgetAction, renderWidget } = props;
    if (widgetAction === 'WIDGET_DELETED') return;

    // 习惯卡上的行点击：先落库再画，别让用户点出一个"没生效的对勾"
    if (widgetAction === 'WIDGET_CLICK' && props.clickAction === TOGGLE_HABIT_ACTION) {
      const data = props.clickActionData as { taskId?: string } | undefined;
      if (data?.taskId) await handleHabitToggle(data.taskId);
    }

    const snap = await readWidgetSnapshot();
    renderWidget(renderRepresentation(snap, widgetInfo.widgetName as WidgetName));
  });

  // App 内数据一变（dataVersion 自增）就主动推给小组件，不等系统 30 分钟
  let lastVersion = useAppStore.getState().dataVersion;
  useAppStore.subscribe((state) => {
    if (state.dataVersion === lastVersion) return;
    lastVersion = state.dataVersion;
    pushWidgets();
  });

  // 启动后先推一次（把刚写好的快照画上去）
  pushWidgets();
}

function pushWidgets(): void {
  const snap = computeWidgetSnapshot();
  for (const name of WIDGET_NAMES) {
    void requestWidgetUpdate({
      widgetName: name,
      renderWidget: () => renderRepresentation(snap, name),
    });
  }
}
