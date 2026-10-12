import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TaskKind, TaskStatus } from '@/domain/enums';
import { describeRepeat } from '@/domain/repeat-next';
import { subtaskProgress } from '@/domain/subtask-progress';
import { isAllDay, taskDue, type Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { describeDue, formatDayTime } from '@/utils/datetime';

/** 类型的中文短标签，界面上一律用它，不直接显示英文枚举 */
export const KIND_LABEL: Record<TaskKind, string> = {
  [TaskKind.Schedule]: '日程',
  [TaskKind.Execution]: '执行',
  [TaskKind.Habit]: '习惯',
  [TaskKind.Idea]: '想法',
};

export interface TaskRowProps {
  task: Task;
  /** 勾选完成。这是唯一的"完成"入口 —— 整行点击只负责打开详情 */
  onComplete?: (task: Task) => void;
  onPress?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  /** 右侧尾部插槽（例如日历里的拖拽抓手） */
  trailing?: ReactNode;
  /**
   * 无时间任务是否显示「待规划」标签。默认 true。
   * 待办页本身就是一个"待规划桶"，每条再标「待规划」是冗余，传 false。
   */
  showPendingLabel?: boolean;
  /**
   * 就地展开的子任务（待办页用）。
   *
   * **只有两步以上才给展开器**：一步不算"拆开了"，为它单开一层折叠
   * 只是多一个要点的东西 —— 那时候这行就该跟普通任务一个样。
   */
  children?: readonly Task[];
  expanded?: boolean;
  /** 点小三角。点整行仍然是进详情页，两件事不混 */
  onToggleExpand?: (task: Task) => void;
  /**
   * 是否处于多选模式。开启时：
   * - 左侧的完成圈**换成选中框**（方框 + 勾），不并存两个圈 —— 两个圈并排会让人
   *   分不清哪个是"做完了"、哪个是"选上了"。
   * - 整行点击 = 切换选中（不进详情页）。完成时隐藏。
   */
  selecting?: boolean;
  /** 本行是否已被选中 */
  selected?: boolean;
  /** 切换选中。只在 `selecting` 时由左侧控件与整行点击调用 */
  onToggleSelect?: (task: Task) => void;
}

/** 展开器出现的门槛：两步以上。见 `children` 上的注释 */
export const EXPANDABLE_STEPS = 2;

export function TaskRow({
  task,
  onComplete,
  onPress,
  onDelete,
  trailing,
  showPendingLabel = true,
  children,
  expanded = false,
  onToggleExpand,
  selecting = false,
  selected = false,
  onToggleSelect,
}: TaskRowProps) {
  const theme = useTheme();
  const done = task.status === TaskStatus.Done;
  // 选择模式下整行点击 = 切换选中，不进详情；完成时那一侧的"完成圈"也藏起来
  const handleRowPress = () => {
    if (selecting) onToggleSelect?.(task);
    else onPress?.(task);
  };
  // 行上显示的是"期限"（优先截止），不是"什么时候发生" —— 两者不同，见 taskDue 的注释
  const anchor = taskDue(task);

  const kids = children ?? [];
  const canExpand = kids.length >= EXPANDABLE_STEPS;
  const progress = subtaskProgress(kids);

  // 「未完成 → 完成」那一刻给勾选圈一个弹出反馈：勾从 0 弹到 1（spring 带轻微过冲），
  // 让"完成了"这件事有正反馈，而不是静默变灰。已完成的行初次渲染不播（prevDone 守住），
  // 撤销再勾回也不重播残影。
  const prevDone = useRef(done);
  const pop = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    if (!prevDone.current && done) {
      pop.value = 0;
      pop.value = withSpring(1, { stiffness: 360, damping: 16, mass: 0.6 });
    }
    prevDone.current = done;
  }, [done, pop]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    opacity: pop.value,
  }));

  return (
    <Pressable
      onPress={handleRowPress}
      // 长按交给外层拖拽手势，这里不抢
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}>
      {selecting ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={selected ? '取消选择' : '选择'}
          onPress={() => onToggleSelect?.(task)}
          style={[
            styles.selectBox,
            {
              borderColor: selected ? theme.tint : theme.textSecondary,
              backgroundColor: selected ? theme.tint : 'transparent',
            },
          ]}>
          {selected ? (
            <Ionicons name="checkmark" size={15} color={theme.background} />
          ) : null}
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? '标记为未完成' : '标记为完成'}
          onPress={() => onComplete?.(task)}
          style={[
            styles.checkbox,
            {
              borderColor: done ? theme.text : theme.textSecondary,
              backgroundColor: done ? theme.text : 'transparent',
            },
          ]}>
          {done ? (
            <Animated.View style={iconStyle} pointerEvents="none">
              <Ionicons name="checkmark" size={15} color={theme.background} />
            </Animated.View>
          ) : null}
        </Pressable>
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          {canExpand ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={expanded ? '收起子任务' : '展开子任务'}
              hitSlop={6}
              onPress={() => onToggleExpand?.(task)}>
              <Ionicons
                name={expanded ? 'caret-down' : 'caret-forward'}
                size={13}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : null}
          <ThemedText
            style={[styles.title, done ? styles.doneText : undefined]}
            themeColor={done ? 'textSecondary' : 'text'}
            numberOfLines={2}>
            {task.title}
          </ThemedText>
        </View>

        <View style={styles.metaRow}>
          {/*
            行上只留"能改变你怎么处理这条"的信息（2026-10-07 从 5 项压到 2-4 项）：
            - 类型只留「习惯」：它意味着能打卡、算法和其他任务不同。日程/执行/想法是
              内部枚举，摆出来只会让人问"这俩有什么区别"；
            - 提醒不显示：它是**设定**不是状态（`null` = 不提醒也是默认），
              定了时间不等于有提醒 —— 摆出来只会让人以为"我没设过怎么会有提醒"；
            - 时间、重复、等谁：都会直接改变你此刻要不要动它，留。

            地点也留：它同样改变你此刻动不动它（"在家"和"去三教"是两种行动），
            而且**只有用户自己填过才出现** —— 与"系统塞进来的那一堆状态"不同，
            不会把每一行都堆满。metaRow 本来就是换行的，多一项不会挤掉别的。
          */}
          {task.kind === TaskKind.Habit ? <Meta text={KIND_LABEL[task.kind]} /> : null}
          {task.repeat ? <Meta text={describeRepeat(task.repeat)} /> : null}
          {task.status === TaskStatus.Waiting && task.waitingFor ? (
            <Meta text={`等 ${task.waitingFor}`} />
          ) : null}
          {anchor ? (
            /*
              全天**不显示时刻**：它压根没落在几点几分，显示 "00:00" 是在替用户
              说一句他没说过的话（而且没人会把 00:00 读成"全天"，只会当成真的半夜）。
            */
            <Meta
              text={
                isAllDay(task.time)
                  ? `${describeDue(anchor)} · 全天`
                  : `${describeDue(anchor)} · ${formatDayTime(anchor)}`
              }
            />
          ) : showPendingLabel ? (
            <Meta text="待规划" muted />
          ) : null}
          {task.location ? <Meta text={task.location} /> : null}
        </View>
      </View>

      <View style={styles.right}>
        {/* 进度只在"真的拆开了"时才出现：一步的话这行就跟普通任务一个样 */}
        {canExpand ? (
          <ThemedText
            type="small"
            themeColor={progress.allDone ? 'textSecondary' : 'text'}
            style={styles.progress}>
            {progress.done}/{progress.total}
          </ThemedText>
        ) : null}
        {!selecting &&
          (onDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除"
              hitSlop={6}
              onPress={() => onDelete(task)}>
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : onPress ? (
            // 能点进详情时给一个方向暗示，而不是让用户猜这行能不能点
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          ) : null)}
        {trailing}
      </View>
    </Pressable>
  );
}

/**
 * 展开后的子任务行（待办页就地勾选）。
 *
 * ⚠️ 整行 = 勾选，**没有"点进去看详情"** —— 拆出来的就是"下一步做什么"，
 * 给它一个详情页等于把一步变成一件事。要改内容去父任务那页改。
 * 勾选走 store 的 `setSubtaskDone`，父任务的完成态跟着子任务自己走。
 */
export function SubtaskRow({
  child,
  onToggle,
}: {
  child: Task;
  onToggle: (child: Task) => void;
}) {
  const theme = useTheme();
  const done = child.status === TaskStatus.Done;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? '取消完成' : '标记为完成'}
      onPress={() => onToggle(child)}
      style={({ pressed }) => [
        styles.childRow,
        { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
      ]}>
      <View
        style={[
          styles.childCheck,
          {
            borderColor: done ? theme.text : theme.textSecondary,
            backgroundColor: done ? theme.text : 'transparent',
          },
        ]}>
        {done ? <Ionicons name="checkmark" size={12} color={theme.background} /> : null}
      </View>
      <ThemedText
        type="small"
        themeColor={done ? 'textSecondary' : 'text'}
        style={[styles.childTitle, done ? styles.childDone : undefined]}
        numberOfLines={2}>
        {child.title}
      </ThemedText>
    </Pressable>
  );
}

function Meta({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <ThemedText
      type="small"
      themeColor="textSecondary"
      style={[styles.meta, muted ? styles.metaMuted : undefined]}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  /**
   * 完成按钮：不再往外扩热区（之前 hitSlop 8 会让整行左侧一小片区域都变成"完成"，
   * 想点进详情或拖拽的时候很容易误触）。要做完一件事，就明确点这个圈。
   */
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * 多选模式下的选中框：**方形**（和完成圈的圆区分开 —— 两个圈并排会让人分不清
   * 哪个是"做完了"、哪个是"选上了"）。选中时填 tint 蓝，和完成圈填 text 也分得开。
   */
  selectBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  /** 三角占掉一点宽度之后标题要能自己撑满剩下的，否则长标题会被挤成两行 */
  title: { flex: 1 },
  /**
   * 进度「2/5」：等宽数字会让它更稳（1/5 → 5/5 时不左右跳）。
   * 用 fontVariant 而不是补空格 —— 补的空格会出现在朗读和无障碍标签里。
   */
  progress: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  doneText: { textDecorationLine: 'line-through' },
  /** 子任务行：往里缩一格，视觉上挂在父任务下面 */
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginLeft: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  childCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childTitle: { flex: 1 },
  childDone: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  meta: { fontSize: 12, lineHeight: 16 },
  metaMuted: { opacity: 0.6 },
  right: { alignItems: 'center', gap: Spacing.two, flexDirection: 'row' },
});
