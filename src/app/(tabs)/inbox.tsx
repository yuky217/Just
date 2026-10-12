import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChoiceSheet } from '@/components/choice-sheet';
import { DayDropBar } from '@/components/day-drop-bar';
import { EmptyState } from '@/components/empty-state';
import {
  ReorderableList,
  type DropPoint,
  type DropZoneRect,
} from '@/components/reorderable-list';
import { Screen } from '@/components/screen';
import { SubtaskRow, TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { UndoBar } from '@/components/undo-bar';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { dayStripDays, dayStripIndexAt, type StripRect } from '@/domain/day-strip';
import {
  buildSemanticTime,
  buildTimeOnDay,
  SEMANTIC_TARGETS,
  type SemanticTarget,
} from '@/domain/schedule-presets';
import { TaskStatus } from '@/domain/enums';
import type { Task } from '@/domain/task';
import { groupTodos, TODO_DONE_LIMIT, type TodoBucket } from '@/domain/todo';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import type { TaskDeleteUndo } from '@/domain/bulk-delete';

/**
 * 待办 = **「我手上欠着什么」的唯一入口**（2026-10-10 定型 + 改名）。
 *
 * 它现在是 `domain/todo.ts` 的五档分档列表：已过期 → 今天 → 往后 →
 * 还没排时间 → 已完成，档内按时间排、空档不显示。
 *
 * ## 名字：原来叫「收集箱」，为什么改成「待办」
 *
 * Inbox（收集箱）在 GTD 里特指"收进来、还没分类的"。这一页原本确实只收
 * `time_attribute = 'none'` 的任务，名字是对的；但改成五档完整列表之后，
 * **名字和内容就对不上了**（里面装着今天要做的、过期的、做完的）。
 * 界面上一处一个词、代码里一处一个词，最后一定会有人问"收集箱和待办是不是两回事"。
 * 所以 Tab 名、面板把手、路由标签统一改成「待办」，和 `domain/todo.ts` 用同一个词。
 * ⚠️ 文件路径与路由仍是 `inbox`（`app/(tabs)/inbox.tsx`、悬浮球深链、
 * `InboxPanel`）—— **改路径要动路由表和深链，收益为零**，所以只改用户看得见的词。
 *
 * ## 为什么从"没时间的任务列表"变成了分档列表
 *
 * 原来这一页只收 `time_attribute = 'none'` 的任务 —— 严格意义上它是
 * "待规划队列"。但用户真正要的是**一进来就看到欠着的事**，而不是
 * "先去日历里那一栏看一遍欠着什么，再回这里排时间"。同一份数据
 * （`groupTodos`）本来就已经在日历里渲染着了，两处渲染的代价是
 * **同一个列表两种手感**（那边不能拖，这边能拖）—— 那是最难向用户解释的
 * 一种不一致。所以合并成一处：这里保留能拖的那一套，日历那一栏撤掉。
 *
 * 分档与排序口径全在 `domain/todo.ts`（有 23 个测试），这一页只负责画。
 *
 * ## 长按的三种去向（都由 `ReorderableList` 提供）
 *
 * - **拖动排序**：只有「还没排时间」档真的落库（`sort_order` 是用户亲手排的
 *   意愿）。「已过期 / 今天 / 往后」三档的先后**是算出来的**（按时间），
 *   拖了会弹回原处，比不能拖更像坏了 —— 所以那些档 `reorderable={false}`。
 * - **原地松手 → 语义词片**：弹「今天 / 明天 / 周末 / 下周 / 稍后」。消化欠着的
 *   事情时第一念是"今天做还是周末做"，不是"14:00 开始"，所以给一组按日期说话的词。
 * - **拖到底部日期条 → 定到某一天**（每一档都能用）。语义词片覆盖不到
 *   "下下周三"，日期条能，而且**已经有时间的那几档等于顺延**：
 *   `buildTimeOnDay` 保留时刻与属性、只换日期（10/8 的截止拖到 10/10 = 10/10 截止）。
 *   这是用户自己下的决定，不是系统替他改时间。
 *
 * ## 已完成
 *
 * 勾掉的东西必须还能找回来 —— 这一档就是它的落点，而且就地能撤销完成
 * （`reopenTask`），不用跑去别的页面。最多列 `TODO_DONE_LIMIT` 条，
 * 再多的去回顾页看。
 */
export default function InboxScreen() {
  const router = useRouter();
  const theme = useTheme();

  const tasks = useAppStore((state) => state.tasks);
  const completeTask = useAppStore((state) => state.completeTask);
  const reopenTask = useAppStore((state) => state.reopenTask);
  const reorderTasks = useAppStore((state) => state.reorderTasks);
  const scheduleTask = useAppStore((state) => state.scheduleTask);
  const toggleSubtask = useAppStore((state) => state.setSubtaskDone);
  const loadSubtasksOfAction = useAppStore((state) => state.loadSubtasksOf);
  const removeTasksAction = useAppStore((state) => state.removeTasks);
  const undoDeleteTasksAction = useAppStore((state) => state.undoDeleteTasks);
  const [reordering, setReordering] = useState(false);
  /** 收起来的档。**默认全展开**（对的默认值 = 用户零操作） */
  const [collapsed, setCollapsed] = useState<TodoBucket[]>([]);
  /** 就地展开了子任务的那几条（父任务 id） */
  const [expanded, setExpanded] = useState<string[]>([]);
  /** 父任务 id → 子任务。整批取，不是每行各查一次库 */
  const [childrenOf, setChildrenOf] = useState<Record<string, Task[]>>({});
  /** 长按原地松手时选中的那一条 —— 非空就弹语义词片 */
  const [arranging, setArranging] = useState<Task | null>(null);

  /*
    多选删除。**全局一份**（2026-10-13 改）。
    原来是"进某一档选择"——每个档头各挂一个「选择」，五个档就是五个一模一样的入口，
    而它们干的事本来就一样。收成右上角一处之后：
    - 屏幕上一屏少五个重复的词；
    - 选择变成**跨档**的，能一次清掉"过期的 + 今天没做完的"这种组合
      （以前得选两次、删两次、撤销两次）。
  */
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 删除后拿到的撤销凭据；非空就显示底部撤销条 */
  const [undoToken, setUndoToken] = useState<TaskDeleteUndo | null>(null);

  const enterSelect = useCallback(() => {
    setSelecting(true);
    setSelectedIds(new Set());
  }, []);
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = useCallback((task: Task) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);
  const deleteSelected = useCallback(() => {
    if (!selectedIds.size) return;
    void removeTasksAction([...selectedIds]).then((undo) => {
      exitSelect();
      setUndoToken(undo);
    });
  }, [selectedIds, removeTasksAction, exitSelect]);
  const undoDelete = useCallback(() => {
    if (!undoToken) return;
    void undoDeleteTasksAction(undoToken).then(() => setUndoToken(null));
  }, [undoToken, undoDeleteTasksAction]);

  /** 拖拽中浮在底部的日期条（只在拖拽时看得见） */
  const [barVisible, setBarVisible] = useState(false);
  /** 手指此刻悬在日期条的第几格 */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  /** 交给手势层的落区（窗口 y 范围）—— 它要跑在 UI 线程里做判定 */
  const [dropZone, setDropZone] = useState<DropZoneRect | null>(null);
  /** 日期条格子区的窗口坐标：手指落在哪一格，全靠它算 */
  const barRect = useRef<StripRect | null>(null);

  /**
   * 每次渲染现算（不缓存在 store 里）：跨过午夜之后"今天"这一档要能自己变；
   * 而且拖动排序写完库之后，分档顺序本来就该跟着刷新。
   */
  const groups = useMemo(() => groupTodos(tasks), [tasks]);

  const toggleGroup = useCallback((bucket: TodoBucket) => {
    setCollapsed((current) =>
      current.includes(bucket) ? current.filter((b) => b !== bucket) : [...current, bucket],
    );
  }, []);

  const toggleExpanded = useCallback((taskId: string) => {
    setExpanded((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  }, []);

  /*
   * 子任务跟着 `tasks` 一起取（一次查库，不是每行一次）。
   *
   * 勾选一步之后 store 会 refresh（`tasks` 换了新的引用），这里自然重取 ——
   * 所以"勾掉最后一步、父任务被推成已完成"这种联动不需要额外接线。
   */
  useEffect(() => {
    const ids = tasks.map((task) => task.id);
    if (!ids.length) {
      setChildrenOf({});
      return;
    }
    let alive = true;
    void loadSubtasksOfAction(ids).then((map) => {
      if (alive) setChildrenOf(map);
    });
    return () => {
      alive = false;
    };
  }, [tasks, loadSubtasksOfAction]);

  /** 就地勾选一步：走 store 的 setSubtaskDone，父任务完成态由它负责重算 */
  const toggleChild = useCallback(
    (child: Task) => {
      void toggleSubtask(child.id, child.status !== TaskStatus.Done);
    },
    [toggleSubtask],
  );

  // 拖拽开始时重算（依赖 barVisible）：挂着一整天不重启的话，"今天"会停在前一天
  const days = useMemo(() => dayStripDays(), [barVisible]);

  const handleBarMeasure = useCallback((rect: StripRect) => {
    barRect.current = rect;
    setDropZone({ top: rect.y, bottom: rect.y + rect.height });
  }, []);

  const handleZoneHover = useCallback((point: DropPoint | null) => {
    const rect = barRect.current;
    setHoverIndex(point && rect ? dayStripIndexAt(rect, point) : null);
  }, []);

  /**
   * 扔进日期条：落到那一格对应的那天。
   *
   * 走 `buildTimeOnDay`（与长按菜单同一份口径）：没时间的落到那天 23:59 截止
   * —— 用户说的是"这天做"，不是"这天 9 点开始"；**已经有时间的只换日期、
   * 时刻照旧**，所以把一条过期的截止拖到未来就等于顺延。
   * 落库后这条就离开原来那一档、出现在日历那一天，**消失本身就是反馈**。
   */
  const handleDropOutside = useCallback(
    (task: Task, point: DropPoint) => {
      const rect = barRect.current;
      const index = rect ? dayStripIndexAt(rect, point) : null;
      if (index === null) return;
      const day = days[index];
      if (!day) return;
      const time = buildTimeOnDay(task, day);
      if (time) void scheduleTask(task.id, time);
    },
    [days, scheduleTask],
  );

  /**
   * 长按结束后紧接着还会来一次 click，得把它吞掉。
   *
   * 原生手势系统在手势激活后会 cancel 掉触摸，所以手机上没这个问题；
   * 但 **web 上 RNGH 的 Pan 不会阻止随后的 click** —— 实测长按一行会
   * 同时弹出语义词片**并且**跳进详情页（长按在勾选圈上还会顺手勾完）。
   * 用时间戳而不是布尔量：万一某端压根没发这次 click（或发了但我们已忽略），
   * 标志也不会永远挂着把用户后面的正常点击一起吃掉。
   */
  const longPressAt = useRef(0);
  const guarded = (action: (task: Task) => void) => (task: Task) => {
    if (Date.now() - longPressAt.current < 500) return;
    action(task);
  };

  /** 拖拽开始/结束：锁滚动、浮出日期条、吞掉紧随其后的那次 click */
  const handleDraggingChange = useCallback((dragging: boolean) => {
    setReordering(dragging);
    setBarVisible(dragging);
    setHoverIndex(null);
    longPressAt.current = Date.now();
  }, []);

  return (
    <Screen
      /*
        没有页头（2026-10-10）：底部 Tab 栏已经写着「待办」，
        副标题那句"先记下来，不必当场决定什么时候做"也是说明书 —— 一并撤掉，
        让列表自己占满这一屏。右上角的「＋」留着（它是这一页唯一的操作）。
      */
      scrollEnabled={!reordering}
      right={
        <View style={styles.headerActions}>
          {selecting ? (
            <Pressable hitSlop={8} accessibilityLabel="取消选择" onPress={exitSelect}>
              <ThemedText type="small" themeColor="tint">
                取消
              </ThemedText>
            </Pressable>
          ) : (
            <Pressable hitSlop={8} accessibilityLabel="选择任务" onPress={enterSelect}>
              <ThemedText type="small" themeColor="textSecondary">
                选择
              </ThemedText>
            </Pressable>
          )}
          {selecting ? null : (
            <Pressable hitSlop={8} onPress={() => router.push('/capture?from=inbox')}>
              <Ionicons name="add" size={24} color={theme.text} />
            </Pressable>
          )}
        </View>
      }
      floating={
        <>
          <DayDropBar
            days={days}
            hoverIndex={hoverIndex}
            visible={barVisible}
            onMeasure={handleBarMeasure}
          />
          {/*
            多选删除的浮条。**不自动消失**：撤销机会被计时器吃掉 = 用户没法反悔。
            - 选择中（有选中项）："已选 N · 删除"
            - 删除后（undoToken 非空）："已删 N 条" + 「撤销」。两者互斥，先删后撤销。
          */}
          {selecting && selectedIds.size > 0 ? (
            <View
              style={[
                styles.selectBar,
                { backgroundColor: theme.backgroundElement },
              ]}>
              <ThemedText type="small" themeColor="text">
                已选 {selectedIds.size}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="删除选中的任务"
                onPress={deleteSelected}>
                <ThemedText type="small" themeColor="tint" style={styles.selectAction}>
                  删除
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
          <UndoBar
            visible={undoToken !== null}
            count={undoToken ? undoToken.ids.length : 0}
            onUndo={undoDelete}
            onDismiss={() => setUndoToken(null)}
          />
        </>
      }>
      {groups.length ? (
        groups.map((group) => {
          const isDoneGroup = group.bucket === 'done';
          // 已完成只是"最近干完了什么"的回顾，不跟上面四档抢屏幕
          const shown = isDoneGroup ? group.tasks.slice(0, TODO_DONE_LIMIT) : group.tasks;
          const hidden = group.tasks.length - shown.length;
          const open = !collapsed.includes(group.bucket);
          return (
            <View key={group.bucket} style={styles.group}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${group.title} ${group.tasks.length} 件`}
                onPress={() => toggleGroup(group.bucket)}
                style={({ pressed }) => [styles.groupHead, { opacity: pressed ? 0.6 : 1 }]}>
                {/*
                  档头只剩三样：档名 · 件数 · 展开箭头。
                  撤掉的圆环和「选择」都是**同一件事说第二遍** ——
                  "今天"两个字已经说了圆环在说什么；「选择」在五个档头各出现一次，
                  等于五个一模一样的入口，而它是个低频动作（收进右上角一处了）。
                */}
                <ThemedText type="smallBold" themeColor={isDoneGroup ? 'textSecondary' : 'text'}>
                  {group.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.groupCount}>
                  {group.tasks.length}
                </ThemedText>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={theme.textSecondary}
                />
              </Pressable>

              {open ? (
                <ReorderableList
                  items={shown}
                  keyOf={(task) => task.id}
                  labelOf={(task) => task.title}
                  gap={Spacing.two}
                  /*
                    只有「还没排时间」档的先后是用户自己排出来的（落 sort_order）。
                    另外三档按时间排，拖了会弹回原处 —— 关掉排序，但仍能拖到日期条。
                    已完成档整条链路都关（它不该被拖去改期，那等于给做完的事重排时间）。
                  */
                  reorderable={group.bucket === 'someday'}
                  // 选择中不给拖：那一刻每一行都是"选中/取消"，拖拽是另一套动作
                  enabled={!isDoneGroup && !selecting}
                  dropZone={dropZone}
                  onDropOutside={handleDropOutside}
                  onZoneHover={handleZoneHover}
                  onDraggingChange={handleDraggingChange}
                  onReorder={(ids) => void reorderTasks(ids)}
                  onLongPressIdle={setArranging}
                  renderItem={(task) => {
                    const kids = childrenOf[task.id] ?? [];
                    const open = expanded.includes(task.id);
                    return (
                      <View>
                        <TaskRow
                          task={task}
                          showPendingLabel={false}
                          children={kids}
                          expanded={open}
                          onToggleExpand={guarded((t) => toggleExpanded(t.id))}
                          onPress={guarded((t) => router.push(`/task/${t.id}`))}
                          // 已完成那档的圈是勾上的，再点一下 = 拿回来（不是再完成一次）
                          onComplete={guarded((t) =>
                            isDoneGroup ? void reopenTask(t.id) : void completeTask(t.id),
                          )}
                          // 全局选择模式下，每一档的每一行都是"选中态"
                          selecting={selecting}
                          selected={selectedIds.has(task.id)}
                          onToggleSelect={toggleSelect}
                        />
                        {open && kids.length ? (
                          <View style={styles.children}>
                            {kids.map((child) => (
                              <SubtaskRow key={child.id} child={child} onToggle={toggleChild} />
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  }}
                />
              ) : null}

              {open && hidden > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.more}>
                  还有 {hidden} 件已完成 · 去回顾页看全部
                </ThemedText>
              ) : null}
            </View>
          );
        })
      ) : (
        <EmptyState
          icon="file-tray-outline"
          title="待办是空的"
          hint="想到什么就丢进来，不用想清楚它属于哪里；写作业、跑步这类要动手的也会出现在这儿"
        />
      )}

      {/* 长按原地松手 → 语义词片：按"哪天"安排，不必先想几点几分。
          选中即落库（走 store 的 scheduleTask，与详情页同一条路），
          这条随即离开这一档、出现在日历上 —— 消失本身就是反馈。 */}
      <ChoiceSheet
        visible={arranging !== null}
        title={arranging ? `安排「${arranging.title}」` : ''}
        options={SEMANTIC_TARGETS.map((target) => ({ key: target.id, label: target.label }))}
        onClose={() => setArranging(null)}
        onSelect={(key) => {
          const task = arranging;
          setArranging(null);
          if (!task) return;
          const time = buildSemanticTime(task, key as SemanticTarget);
          if (time) void scheduleTask(task.id, time);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  /** 档名后面的件数：贴着标题，别被 chevron 推到最右 */
  groupCount: { flex: 1 },
  /** 页头右上角：低频的「选择」和这一页唯一的「＋」并排 */
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  more: { paddingTop: Spacing.one, fontSize: 12 },
  /** 展开出来的几步：整块跟着父任务那一行，不另起一张卡 */
  children: { gap: Spacing.one, paddingTop: Spacing.one },
  /**
   * 选择模式下的底部浮条（"已选 N · 删除"）。和 UndoBar 共用浮层定位，
   * 但它是操作条不是提示条，所以单独一个样式：更靠上、不叠在撤销条的位置。
   */
  selectBar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: BottomTabInset + Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  selectAction: { fontWeight: '600' },
});
