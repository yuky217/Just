import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isCapabilityReady, suggestSchedule } from '@/capabilities/client';
import { AiCapability } from '@/capabilities/types';
import { ChoiceSheet } from '@/components/choice-sheet';
import { DayDropBar } from '@/components/day-drop-bar';
import { EmptyState } from '@/components/empty-state';
import { MultiSelectBar } from '@/components/multi-select-bar';
import {
  ReorderableList,
  type DropPoint,
  type DropZoneRect,
} from '@/components/reorderable-list';
import { ScheduleActionSheet } from '@/components/schedule-action-sheet';
import { ScheduleSuggestSheet } from '@/components/schedule-suggest-sheet';
import { Screen } from '@/components/screen';
import { SubtaskRow, TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { UndoBar } from '@/components/undo-bar';
import { Spacing } from '@/constants/theme';
import { dayStripDays, dayStripIndexAt, type StripRect } from '@/domain/day-strip';
import {
  buildSemanticTime,
  buildTimeOnDay,
  SEMANTIC_TARGETS,
  type SemanticTarget,
} from '@/domain/schedule-presets';
import { TaskStatus } from '@/domain/enums';
import {
  planToTime,
  type ScheduleCandidate,
  type SchedulePlan,
  type ScheduleScope,
} from '@/domain/schedule-suggest';
import type { Task } from '@/domain/task';
import { groupTodos, TODO_DONE_LIMIT, type TodoBucket } from '@/domain/todo';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { selectCapabilityGate, useSettings } from '@/state/settings-store';
import type { TaskDeleteUndo, TaskNestUndo } from '@/domain/bulk-delete';

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
 * - **原地松手 → 进多选**（2026-10-15 改）：把这一条勾上、底部浮出操作条。
 *   原来这一下弹的是「今天 / 明天 / 周末…」词片，词片改由行内那个日历按钮触发 ——
 *   **一个看得见的按钮，胜过一次没人知道的长按**。
 *   用"原地松手"而不是"长按够 300ms"那一刻，是因为那一刻正是拾起这一行的时刻，
 *   在那一刻切进多选会连拖动一起废掉。
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
/** 优先级 → 给模型看的标签（0 = 最高）。「还没排时间」档里多数是默认的 2 = 普通 */
const PRIORITY_LABEL: Record<number, string> = { 0: '最高', 1: '高', 2: '普通', 3: '低' };

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
  const makeSubtaskAction = useAppStore((state) => state.makeSubtask);
  const undoNestAction = useAppStore((state) => state.undoNest);
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
  /** 删除 / 嵌套后拿到的撤销凭据；非空就显示底部撤销条（两条共用一条 UndoBar） */
  const [undoToken, setUndoToken] = useState<
    | { kind: 'delete'; undo: TaskDeleteUndo }
    | { kind: 'nest'; undo: TaskNestUndo }
    | null
  >(null);

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
      setUndoToken({ kind: 'delete', undo });
    });
  }, [selectedIds, removeTasksAction, exitSelect]);
  const undoDelete = useCallback(() => {
    const token = undoToken;
    if (!token) return;
    const pending =
      token.kind === 'delete' ? undoDeleteTasksAction(token.undo) : undoNestAction(token.undo);
    void pending.then(() => setUndoToken(null));
  }, [undoToken, undoDeleteTasksAction, undoNestAction]);

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

  /*
    「AI 帮我排」（2026-10-13）：把「还没排时间」那一档喂给模型，结合优先级给一版安排。
    入口只在**能力真开着且配了接口**时出现（`isCapabilityReady`）——
    界面不许拿没接线的开关承诺任何事（见 capabilities/client 顶部那三条边界）。

    2026-10-15 补两条：
    1. **排期条件可调**（往后排几天 / 每天排在哪个时段）。**有默认值，可以不调** ——
       不碰它的人一次都不用碰；调过一次存进设置，下次沿用。档位与判定
       在 `domain/schedule-suggest`（唯一口径），这一页只负责把用户选的递进去。
    2. **可以只排勾选的这几条**：长按进多选 → 底部那条工具条上出现「帮我排」。
       `suggestSource` 记这次是排「整档」还是排「勾选的」，候选清单跟着它走。
  */
  const gate = useSettings(selectCapabilityGate);
  const canSchedule = isCapabilityReady(gate, AiCapability.Schedule);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestSource, setSuggestSource] = useState<'bucket' | 'selected'>('bucket');
  const windowDays = useSettings((state) => state.scheduleWindowDays);
  const dayPartId = useSettings((state) => state.scheduleDayPart);
  const setScheduleWindowDays = useSettings((state) => state.setScheduleWindowDays);
  const setScheduleDayPart = useSettings((state) => state.setScheduleDayPart);
  const scope: ScheduleScope = useMemo(() => ({ windowDays, dayPartId }), [windowDays, dayPartId]);

  /** 多选「排期」面板：把选中的一批统一排到某天 */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const handleScheduleApply = useCallback(
    (target: SemanticTarget) => {
      setScheduleOpen(false);
      if (!selectedIds.size) return;
      // 退出选择后逐条排期（与单条长按菜单同一条路 buildSemanticTime → scheduleTask）
      const ids = [...selectedIds];
      exitSelect();
      for (const id of ids) {
        const task = tasks.find((t) => t.id === id);
        if (task) {
          const time = buildSemanticTime(task, target);
          if (time) void scheduleTask(task.id, time);
        }
      }
    },
    [selectedIds, tasks, scheduleTask, exitSelect],
  );

  /** 只把「还没排时间」那一档当作候选 —— 已经有时间的不用再排 */
  const somedayTasks = useMemo(
    () => groups.find((g) => g.bucket === 'someday')?.tasks ?? [],
    [groups],
  );
  /**
   * 勾选中、且确实还没排时间的那几条。
   * 它是「帮我排」能不能出现的判据：**一条都没有就不给这个按钮** ——
   * 已经有时间的不用再排，一个点了必然报错的按钮是界面在承诺做不到的事。
   */
  const selectedSomeday = useMemo(
    () => somedayTasks.filter((task) => selectedIds.has(task.id)),
    [somedayTasks, selectedIds],
  );

  const toCandidates = useCallback(
    (list: readonly Task[]): ScheduleCandidate[] =>
      list.map((task) => ({
        id: task.id,
        title: task.title,
        durationMinutes: task.targetMinutes ?? null,
        priorityLabel: PRIORITY_LABEL[task.priority] ?? null,
      })),
    [],
  );

  /** 这一次的候选：整档 或 勾选的那几条 */
  const candidates = useMemo(
    () => toCandidates(suggestSource === 'selected' ? selectedSomeday : somedayTasks),
    [toCandidates, suggestSource, selectedSomeday, somedayTasks],
  );

  /** 建议面板按 id 取标题显示（勾选中/整档两种来源都要能查到） */
  const titleOf = useCallback(
    (id: string) => tasks.find((task) => task.id === id)?.title ?? '',
    [tasks],
  );

  /** 用户确认后逐条落库（走 store 的 scheduleTask，与行内「安排到哪天」同一条路） */
  const applyPlans = useCallback(
    (plans: readonly SchedulePlan[]) => {
      setSuggestOpen(false);
      for (const plan of plans) {
        const time = planToTime(plan);
        if (time) void scheduleTask(plan.id, time);
      }
      // 排完就退出选择：那几条已经离开这一档了，留一个空的选择态没有意义
      if (suggestSource === 'selected') exitSelect();
    },
    [scheduleTask, suggestSource, exitSelect],
  );

  /** 改排期条件 → 存进设置（下次沿用）；面板收到新 scope 会自己重排 */
  const changeScope = useCallback(
    (next: ScheduleScope) => {
      setScheduleWindowDays(next.windowDays);
      setScheduleDayPart(next.dayPartId);
    },
    [setScheduleWindowDays, setScheduleDayPart],
  );

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
   * 拖拽变子任务：把 child 挂到 parent 下面。
   *
   * 挂完自动展开 parent —— 否则 child 从顶层列表消失、又没展开，用户会以为它凭空没了。
   * 撤销凭据交给 UndoBar（和删除共用一条）。
   */
  const handleNest = useCallback(
    (child: Task, parent: Task) => {
      if (child.id === parent.id) return;
      void makeSubtaskAction(child.id, parent.id).then((undo) => {
        setExpanded((cur) => (cur.includes(parent.id) ? cur : [...cur, parent.id]));
        if (undo) setUndoToken({ kind: 'nest', undo });
      });
    },
    [makeSubtaskAction],
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

  /**
   * 长按后**原地松手** → 进多选，并把这一条顺手勾上（2026-10-15 改）。
   *
   * 用"原地松手"这个信号，而不是"长按够 300ms"那一刻 —— 那一刻正是
   * `ReorderableList` **拾起**这一行的时刻，在那一瞬间切进多选会把拖动排序、
   * 拖到底部日期条这两件事一起废掉（选择模式下手势是关的）。而"长按了但没拖动"
   * 原本就是另一个意思：它此前弹「今天/明天/周末」词片，现在换成进多选，
   * 词片挪到行内那个日历按钮（`TaskRow.onPickDay`）——
   * 一个看得见的按钮，胜过一次没人知道的长按。
   *
   * 顺手勾上这一条：长按一条就是"我要它"，再补一次点击是白走一步。
   * 末尾那次 click 照旧要吞（见上）。
   */
  const handleLongPressIdle = useCallback((task: Task) => {
    setSelecting(true);
    setSelectedIds(new Set([task.id]));
    longPressAt.current = Date.now();
  }, []);

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
            多选操作条（与想法页共用的 MultiSelectBar）。**不自动消失**：撤销机会被
            计时器吃掉 = 用户没法反悔。删除后的撤销条由下面的 UndoBar 单独负责。
          */}
          {selecting && selectedIds.size > 0 ? (
            <MultiSelectBar
              count={selectedIds.size}
              onDelete={deleteSelected}
              onSchedule={() => setScheduleOpen(true)}
              // 只在勾中的确有"还没排时间"的任务时才给：AI 只排这几条，排不了就不出现
              onSuggest={
                canSchedule && selectedSomeday.length
                  ? () => {
                      setSuggestSource('selected');
                      setSuggestOpen(true);
                    }
                  : undefined
              }
            />
          ) : null}
          <UndoBar
            visible={undoToken !== null}
            count={undoToken ? (undoToken.kind === 'delete' ? undoToken.undo.ids.length : 1) : 0}
            message={undoToken?.kind === 'nest' ? '已设为子任务' : undefined}
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
                {group.bucket === 'someday' && canSchedule && !selecting ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="让 AI 帮我排这一档"
                    hitSlop={8}
                    onPress={(event) => {
                      event.stopPropagation();
                      setSuggestSource('bucket');
                      setSuggestOpen(true);
                    }}
                    style={({ pressed }) => [styles.suggestBtn, { opacity: pressed ? 0.6 : 1 }]}>
                    <Ionicons name="sparkles-outline" size={14} color={theme.tint} />
                    <ThemedText type="small" style={{ color: theme.tint }}>
                      帮我排
                    </ThemedText>
                  </Pressable>
                ) : null}
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

                    嵌套和排序**解耦**：不能排序的档也能把一条挂到另一条下面，
                    所以 nestable 只看是不是已完成档。
                  */
                  reorderable={group.bucket === 'someday'}
                  nestable={group.bucket !== 'done'}
                  // 选择中不给拖：那一刻每一行都是"选中/取消"，拖拽是另一套动作
                  enabled={!isDoneGroup && !selecting}
                  dropZone={dropZone}
                  onDropOutside={handleDropOutside}
                  onZoneHover={handleZoneHover}
                  onDraggingChange={handleDraggingChange}
                  onReorder={(ids) => void reorderTasks(ids)}
                  onLongPressIdle={handleLongPressIdle}
                  onNest={handleNest}
                  renderItem={(task, _index, _dragging, nesting) => {
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
                          nesting={nesting}
                          // 「今天/明天/周末…」词片的行内入口（已完成档不给：给做完的事
                          // 重新挑一天没有意义）
                          onPickDay={isDoneGroup ? undefined : guarded(setArranging)}
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

      {/* AI 批量排期：生成一版建议 → 用户逐条勾选 → 才落库（与拆解面板同一原则） */}
      <ScheduleSuggestSheet
        visible={suggestOpen}
        scope={scope}
        onChangeScope={changeScope}
        onClose={() => setSuggestOpen(false)}
        onGenerate={() =>
          suggestSchedule(selectCapabilityGate(useSettings.getState()), { candidates, scope })
        }
        titleOf={titleOf}
        onSubmit={applyPlans}
      />

      {/* 多选「排期」：把选中的一批统一排到某天（词片与单条长按菜单同一组） */}
      <ScheduleActionSheet
        visible={scheduleOpen}
        count={selectedIds.size}
        onClose={() => setScheduleOpen(false)}
        onApply={handleScheduleApply}
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
  /** 「还没排时间」档头右侧的「帮我排」：低频动作，字号跟件数一致、颜色走 tint */
  suggestBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  /** 页头右上角：低频的「选择」和这一页唯一的「＋」并排 */
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  more: { paddingTop: Spacing.one, fontSize: 12 },
  /** 展开出来的几步：整块跟着父任务那一行，不另起一张卡 */
  children: { gap: Spacing.one, paddingTop: Spacing.one },
});
