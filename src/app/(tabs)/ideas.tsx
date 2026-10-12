import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { TagEditorSheet } from '@/components/tag-editor-sheet';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UndoBar } from '@/components/undo-bar';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { Idea } from '@/domain/idea';
import { IDEA_TIME_RANGES, IDEA_TIME_RANGE_LABEL, filterIdeas } from '@/domain/idea-filter';
import type { IdeaTimeRange } from '@/domain/idea-filter';
import type { IdeaDeleteUndo } from '@/domain/bulk-delete';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatMonthDay } from '@/utils/datetime';

/**
 * 想法库（主文档第四节里"软的那一档"）。
 *
 * 三条设计约束在这里是可见的：
 * - 想法不提醒、不催办，只负责"记下来不丢"；
 * - 检索是**本地的按字面匹配**（搜的字要原样出现在想法里）。设置里那个
 *   「语义检索」开关**还没接上** —— 它此前只改了搜索框的占位文案，
 *   AI 调用一行都没写。界面在承诺、代码不兑现比不做更伤，所以这一页
 *   从现在起不再提它（2026-10-10）。真要做得另开一条；
 * - 归档而不是删除：想法只有被想起来的价值，没有清理的义务。
 *
 * ⚠️ 但"归档"必须**可逆**：归档按钮此前点一下就永久消失（`archived_at`
 * 只被用来过滤，没有任何界面能看到归档过的东西）—— 那就不是"归档"，
 * 是"删掉但骗自己说还能找回来"。所以页脚有一个归档箱：能翻、能放回、也能真删。
 */
/**
 * 想法页的撤销凭据。
 *
 * 归档与删除是两件不同的事，倒回去的做法也不同，所以这里记的不是
 * "刚才发生了什么"，而是"怎么把它退回来"：
 * - 归档：`archived_at` 只是个标记，行一直在库里 —— 倒回去就是清掉它，
 *   因此只需要知道是哪些 id；
 * - 删除：走的是软删（`deleted_at`），凭据由仓储那侧交回来（见 bulk-delete）。
 */
type IdeaUndo =
  | { kind: 'archive'; ids: readonly string[] }
  | { kind: 'delete'; undo: IdeaDeleteUndo };

export default function IdeasScreen() {
  const theme = useTheme();
  const router = useRouter();

  const ideas = useAppStore((state) => state.ideas);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const capture = useAppStore((state) => state.capture);
  const tasks = useAppStore((state) => state.tasks);
  const archiveIdea = useAppStore((state) => state.archiveIdea);
  const loadArchivedIdeas = useAppStore((state) => state.loadArchivedIdeas);
  const unarchiveIdea = useAppStore((state) => state.unarchiveIdea);
  const removeIdeasAction = useAppStore((state) => state.removeIdeas);
  const undoDeleteIdeasAction = useAppStore((state) => state.undoDeleteIdeas);
  const saveIdea = useAppStore((state) => state.saveIdea);

  const [keyword, setKeyword] = useState('');
  /**
   * 检索的三个维度：关键词 × 标签 × 时间范围，三者正交、可叠加。
   * 收在 `filterIdeas`（domain）里算，页面只负责把三个值喂进去。
   */
  const [range, setRange] = useState<IdeaTimeRange>('all');
  /*
    主列表多选删除。想法页只有主列表会积压（归档箱里一条条删就够了），
    所以选择模式只开在主列表。
  */
  const [selectingIdeas, setSelectingIdeas] = useState(false);
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(new Set());
  /**
   * 底部那条撤销机会，归档与删除共用。
   *
   * 为什么能共用：两者在用户眼里是同一件事的一半 —— "东西从眼前没了"，
   * 只是去了不同的地方（归档箱 / 真没了）。位置、交互、一句话，全都一样，
   * 只有那句话说的事不同。所以它是一条提示、两种来源，不是两条提示。
   *
   * 只留一个 token：新的会把旧的顶掉。可以接受 —— 归档过的东西还能在
   * 归档箱里找到；而删除……所以删除后那条提示用户得**现在**决定，这也对。
   */
  const [ideaUndo, setIdeaUndo] = useState<IdeaUndo | null>(null);

  /*
    标签：① 正在编辑标签的那条想法（null = 面板没开）；② 当前按哪个标签在筛。
    两者互不干扰 —— 筛选是看，编辑是改。
  */
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const openTagEditor = useCallback((idea: Idea) => setEditingIdea(idea), []);
  const closeTagEditor = useCallback(() => setEditingIdea(null), []);
  const handleSaveTags = useCallback(
    (tags: string[]) => {
      const target = editingIdea;
      setEditingIdea(null);
      if (target) void saveIdea({ ...target, tags });
    },
    [editingIdea, saveIdea],
  );
  const filterByTag = useCallback((tag: string) => setActiveTag(tag), []);
  const clearFilter = useCallback(() => setActiveTag(null), []);

  const enterSelectIdeas = useCallback(() => {
    setSelectingIdeas(true);
    setSelectedIdeaIds(new Set());
  }, []);
  const exitSelectIdeas = useCallback(() => {
    setSelectingIdeas(false);
    setSelectedIdeaIds(new Set());
  }, []);
  const toggleSelectIdea = useCallback((idea: Idea) => {
    setSelectedIdeaIds((current) => {
      const next = new Set(current);
      if (next.has(idea.id)) next.delete(idea.id);
      else next.add(idea.id);
      return next;
    });
  }, []);
  const deleteSelectedIdeas = useCallback(() => {
    if (!selectedIdeaIds.size) return;
    void removeIdeasAction([...selectedIdeaIds]).then((undo) => {
      exitSelectIdeas();
      setIdeaUndo({ kind: 'delete', undo });
    });
  }, [selectedIdeaIds, removeIdeasAction, exitSelectIdeas]);

  /**
   * 左滑「归档」。
   *
   * 归档本身是可逆的（`archived_at` 只是个标记，行还在库里），但要用户
   * 知道"还能去归档箱找回来"才有意义 —— 所以给一条撤销，让他不必先信这句话。
   */
  const archiveOneIdea = useCallback(
    (id: string) => {
      void archiveIdea(id).then(() => setIdeaUndo({ kind: 'archive', ids: [id] }));
    },
    [archiveIdea],
  );

  /**
   * 删掉一条想法（左滑的「删除」、归档箱里的「彻底删掉」都走它）。
   * 走 `removeIdeas` 而不是仓储的 `softDelete`：只有它会**把撤销凭据交回来**。
   * 删除必须可撤销 —— 一次手滑就是永久的事。
   */
  const deleteOneIdea = useCallback(
    (id: string) => {
      void removeIdeasAction([id]).then((undo) => setIdeaUndo({ kind: 'delete', undo }));
    },
    [removeIdeasAction],
  );

  const undoIdeaAction = useCallback(() => {
    const token = ideaUndo;
    if (!token) return;
    setIdeaUndo(null);
    if (token.kind === 'archive') {
      void (async () => {
        for (const id of token.ids) await unarchiveIdea(id);
      })();
    } else {
      void undoDeleteIdeasAction(token.undo);
    }
  }, [ideaUndo, unarchiveIdea, undoDeleteIdeasAction]);

  /** 撤销条要说几件事：归档了 N 条 / 删了 N 条 —— 数字取实际那个 */
  const undoItemCount = ideaUndo
    ? ideaUndo.kind === 'archive'
      ? ideaUndo.ids.length
      : ideaUndo.undo.ids.length
    : 0;
  /** 归档**不能**说成"已删"：那会让用户以为东西没了，白跑一趟归档箱 */
  const undoMessage = ideaUndo?.kind === 'archive' ? `已归档 ${undoItemCount} 条` : undefined;

  /**
   * 这条想法转成的那条任务（没转过 / 那条任务已被删 → undefined）。
   *
   * 现查而不是在想法上存个布尔：指针在不在、指向的东西还在不在，都是实时事实。
   * 任务被删掉时当作"没转过" —— 不然行上会写着"已转成任务"，点进去却是空白。
   */
  const convertedTaskOf = useCallback(
    (idea: Idea) =>
      idea.convertedTaskId ? tasks.find((task) => task.id === idea.convertedTaskId) : undefined,
    [tasks],
  );

  /**
   * 整个想法库里出现过的标签，按使用次数降序 —— 给标签编辑面板做联想用。
   * 现算（不查库）：`ideas` 已经在内存里，标签又少，没必要为它再开一条查询。
   */
  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const idea of ideas) {
      for (const tag of idea.tags) {
        const key = tag.toLowerCase();
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [ideas]);

  /**
   * 点一行 → 进想法详情页（2026-10-12）。
   *
   * 以前这里直接打开拆解面板，拆过则跳去任务 —— 那是把想法当任务对待。
   * 想法连"要不要做"都还没定，它的动作是**记录 · 加标签 · 筛选 · 归档 · 转成任务**，
   * 详情页就是这几件事的家。转成任务之后想拆细，去那条任务的详情页拆。
   */
  const openIdea = useCallback(
    (idea: Idea) => {
      router.push(`/idea/${idea.id}`);
    },
    [router],
  );

  /**
   * 同一时刻只让一行滑开。新的一行滑开时把上一行收回去 ——
   * 屏幕上同时挂着两三行露着按钮，既乱又容易点错。
   *
   * 用一个 ref 记"当前那行的收回动作"（每个 IdeaRow 把自己的握在手里），
   * 而不是让页面去存一组 ref：页面根本不需要知道有几行、它们是谁。
   */
  const closeOpenRow = useRef<(() => void) | null>(null);
  const handleRowWillOpen = useCallback((close: () => void) => {
    const previous = closeOpenRow.current;
    closeOpenRow.current = close;
    if (previous && previous !== close) previous();
  }, []);

  /**
   * 归档箱：默认收起，翻的时候才拉数据。
   * 归档/恢复/删除之后 `dataVersion` 会变，靠它重新拉一遍（不进 refresh）。
   */
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archived, setArchived] = useState<Idea[]>([]);

  const reloadArchived = useCallback(async () => {
    setArchived(await loadArchivedIdeas());
  }, [loadArchivedIdeas]);

  useEffect(() => {
    if (!archiveOpen) return;
    void reloadArchived();
  }, [archiveOpen, dataVersion, reloadArchived]);

  /** 检索：时间范围 × 标签 × 关键词，口径全在 `filterIdeas` 里 */
  const visible = useMemo(
    () => filterIdeas(ideas, { keyword, tag: activeTag, range }),
    [ideas, keyword, activeTag, range],
  );
  /** 当前是不是"在看一部份" —— 空态的文案要区分"库里本来就空"和"筛完没剩" */
  const filtering = Boolean(keyword.trim()) || Boolean(activeTag) || range !== 'all';

  return (
    <Screen
      /*
        没有页头（2026-10-10）：底部 Tab 栏已经写着「想法」，左上角再写一遍，
        下面还压一行"不提醒、不催办"的说明书 —— 两行高度都是从列表身上抠的。
        这一页的主角是那些念头，不是它自己的名字。
      */
      right={
        <Pressable hitSlop={8} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      }
      floating={
        <>
          {/*
            多选删除的浮条。**不自动消失**：撤销机会被计时器吃掉 = 用户没法反悔。
            - 选择中（有选中项）："已选 N · 删除"
            - 删除后（undoToken 非空）："已删 N 条" + 「撤销」。两者互斥，先删后撤销。
          */}
          {selectingIdeas && selectedIdeaIds.size > 0 ? (
            <View
              style={[
                styles.selectBar,
                { backgroundColor: theme.backgroundElement },
              ]}>
              <ThemedText type="small" themeColor="text">
                已选 {selectedIdeaIds.size}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="删除选中的想法"
                onPress={deleteSelectedIdeas}>
                <ThemedText type="small" themeColor="tint" style={styles.selectAction}>
                  删除
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
          <UndoBar
            visible={ideaUndo !== null}
            count={undoItemCount}
            message={undoMessage}
            onUndo={undoIdeaAction}
            onDismiss={() => setIdeaUndo(null)}
          />
        </>
      }>
      {/*
        想法页这一格就是为灵感生的（ideaOnly）：不给时间/清单/重复/提醒 ——
        想法不排期也不催办，摆着那四个键只能让人以为"灵感也得定个时间"。
      */}
      <CaptureInput
        placeholder="记一个念头、一点灵感…"
        ideaOnly
        onSubmit={async (text) => {
          await capture({ text, markedAsInspiration: true });
        }}
      />

      <View
        style={[
          styles.searchBox,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="按关键词找"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {selectingIdeas ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消选择"
            onPress={exitSelectIdeas}
            hitSlop={6}>
            <ThemedText type="small" themeColor="tint">
              取消
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择想法"
            onPress={enterSelectIdeas}
            hitSlop={6}>
            <ThemedText type="small" themeColor="textSecondary">
              选择
            </ThemedText>
          </Pressable>
        )}
      </View>

      {/*
        筛选行：时间范围（全部 / 今天 / 本周 / 本月）+ 当前标签。
        都是"点一下"的事 —— 手机上一个点比打字快一个量级，这正是做筛选的理由。
        两个维度正交：时间管"什么时候记的"，标签管"是关于什么的"，可以同时生效。
      */}
      <View style={styles.filterRow}>
        {IDEA_TIME_RANGES.map((option) => {
          const active = range === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`只看${IDEA_TIME_RANGE_LABEL[option]}记下的`}
              onPress={() => setRange(option)}
              style={[
                styles.rangeChip,
                {
                  backgroundColor: active ? theme.text : theme.backgroundElement,
                  borderColor: active ? theme.text : theme.backgroundSelected,
                },
              ]}>
              <ThemedText
                type="small"
                style={{ color: active ? theme.background : theme.textSecondary }}>
                {IDEA_TIME_RANGE_LABEL[option]}
              </ThemedText>
            </Pressable>
          );
        })}
        {activeTag ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`取消按标签「${activeTag}」筛选`}
            onPress={clearFilter}
            style={[
              styles.rangeChip,
              { backgroundColor: theme.backgroundElement, borderColor: theme.tint },
            ]}>
            <Ionicons name="pricetag-outline" size={13} color={theme.tint} />
            <ThemedText type="small" themeColor="tint">
              {activeTag}
            </ThemedText>
            <Ionicons name="close" size={13} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {visible.length ? (
        <View style={styles.list}>
          {visible.map((idea) => (
            <IdeaRow
              key={idea.id}
              idea={idea}
              converted={Boolean(convertedTaskOf(idea))}
              selecting={selectingIdeas}
              selected={selectedIdeaIds.has(idea.id)}
              onToggleSelect={toggleSelectIdea}
              onOpen={() => openIdea(idea)}
              onArchive={archiveOneIdea}
              onDelete={deleteOneIdea}
              onTagTap={filterByTag}
              onEditTags={() => openTagEditor(idea)}
              onWillOpen={handleRowWillOpen}
            />
          ))}
        </View>
      ) : null}

      {/*
        空态。原本放在 visible.length 为假时渲染，但筛选/搜索都可能让列表变空，
        所以单独判断：要么"库本来就是空的"，要么"当前过滤条件下没有匹配"。
      */}
      {visible.length ? null : (
        <EmptyState
          icon="bulb-outline"
          title={filtering ? '没有匹配的想法' : '想法库还是空的'}
          hint={filtering ? '换个说法或清掉筛选' : '随手记一句，将来的你会感谢现在的你'}
        />
      )}

      {/*
        归档箱。默认收起（它不该跟主列表抢注意力），但必须存在 ——
        否则"归档"按钮就是"永久删除"的委婉说法。
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: archiveOpen }}
        onPress={() => setArchiveOpen((open) => !open)}
        style={({ pressed }) => [styles.archiveToggle, { opacity: pressed ? 0.6 : 1 }]}>
        <Ionicons
          name={archiveOpen ? 'chevron-up' : 'archive-outline'}
          size={14}
          color={theme.textSecondary}
        />
        <ThemedText type="small" themeColor="textSecondary">
          归档箱
        </ThemedText>
      </Pressable>

      {archiveOpen ? (
        <Card hint="归档只是收起来，想法本身还在。想留就放回去，想清就删掉。">
          {archived.length ? (
            archived.map((idea) => (
              <View key={idea.id} style={styles.archivedRow}>
                <View style={styles.ideaBody}>
                  <ThemedText type="small" numberOfLines={3}>
                    {idea.content}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.ideaMeta}>
                    {formatMonthDay(new Date(idea.createdAt))} 记下
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="放回想法库"
                  hitSlop={8}
                  onPress={() => void unarchiveIdea(idea.id)}>
                  <Ionicons name="arrow-undo-outline" size={17} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="彻底删掉这条想法"
                  hitSlop={8}
                  onPress={() => deleteOneIdea(idea.id)}>
                  <Ionicons name="trash-outline" size={17} color={theme.textSecondary} />
                </Pressable>
              </View>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              还没有归档过东西。
            </ThemedText>
          )}
        </Card>
      ) : null}

      {/*
        标签编辑面板。它是 Modal，挂在哪都不影响层级，放最后即可。
        allTags 是整库标签联想；保存走 store.saveIdea（落库 + 刷新，列表 chip 立即变）。
      */}
      <TagEditorSheet
        visible={editingIdea !== null}
        idea={editingIdea}
        allTags={allTags}
        onSave={handleSaveTags}
        onClose={closeTagEditor}
      />
    </Screen>
  );
}

function IdeaRow({
  idea,
  converted,
  selecting = false,
  selected = false,
  onToggleSelect,
  onOpen,
  onArchive,
  onDelete,
  onTagTap,
  onEditTags,
  onWillOpen,
}: {
  idea: Idea;
  /** 已经转成任务了吗（转出来的那条任务还在） */
  converted: boolean;
  /** 是否处于多选模式（主列表用） */
  selecting?: boolean;
  /** 本行是否被选中 */
  selected?: boolean;
  /** 切换选中（只在 selecting 时由整行点击调用） */
  onToggleSelect?: (idea: Idea) => void;
  onOpen: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  /** 点标签 chip = 按这个标签筛选 */
  onTagTap?: (tag: string) => void;
  /** 点「＋标签」= 打开编辑面板 */
  onEditTags?: () => void;
  /** 本行即将滑开时通知页面，好把别的行收回去 */
  onWillOpen?: (close: () => void) => void;
}) {
  const theme = useTheme();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const handlePress = () => {
    if (selecting) onToggleSelect?.(idea);
    else onOpen();
  };
  return (
    /*
      左滑出「归档 / 删除」。
      ⚠️ 为什么不做成行内的按钮：此前行右侧挂着一个常驻的归档图标，而删除
      **根本没有入口**（详情页也只有归档）。那个常驻图标的毛病是"永远在手边" ——
      一条想法被越读越多、越想越久，最不需要的就是一个随手可点的"收起来"。
      左滑把两者都收进"你得先做个动作"里，列表也因此空出一整列给内容本身。
      ⚠️ 多选模式下关掉手势：那时整行是"选择"语义，左滑会撞车。
    */
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!selecting}
      rightThreshold={36}
      // 没有左侧动作，允许回弹就会在左边露出片空白
      overshootRight={false}
      onSwipeableWillOpen={() => onWillOpen?.(() => swipeRef.current?.close())}
      // 行本身是圆角块，露出的按钮得跟它同一个圆角轮廓，否则角上会凸出来
      containerStyle={styles.swipeContainer}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`归档「${idea.content}」（能在下面的归档箱里放回来）`}
            onPress={() => onArchive(idea.id)}
            style={[styles.swipeAction, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="archive-outline" size={19} color={theme.text} />
            <ThemedText type="small" themeColor="text">
              归档
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`删除「${idea.content}」`}
            onPress={() => onDelete(idea.id)}
            style={[styles.swipeAction, { backgroundColor: theme.text }]}>
            <Ionicons name="trash-outline" size={19} color={theme.background} />
            <ThemedText type="small" themeColor="background">
              删除
            </ThemedText>
          </Pressable>
        </View>
      )}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          selecting
            ? selected
              ? '取消选择'
              : '选择'
            : `打开「${idea.content}」${converted ? '（已转成任务）' : ''}`
        }
        onPress={handlePress}
        style={({ pressed }) => [
          styles.ideaRow,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
        ]}>
        {selecting ? (
          <View
            style={[
              styles.ideaSelectBox,
              {
                borderColor: selected ? theme.tint : theme.textSecondary,
                backgroundColor: selected ? theme.tint : 'transparent',
              },
            ]}>
            {selected ? (
              <Ionicons name="checkmark" size={14} color={theme.background} />
            ) : null}
          </View>
        ) : null}
        <View style={styles.ideaBody}>
          <ThemedText numberOfLines={5}>{idea.content}</ThemedText>

          {/*
            标签 chip 行。有标签就显示 chip + 末尾「＋」加标；没有标签就只显示「＋ 标签」入口。
            多选模式下整行是"选择"语义，标签不再可点（既不筛选也不编辑），只作展示。
          */}
          {idea.tags.length ? (
            <View style={styles.tagRow}>
              {idea.tags.map((tag) => (
                <Pressable
                  key={tag}
                  accessibilityRole="button"
                  accessibilityLabel={`按标签「${tag}」筛选`}
                  disabled={selecting}
                  onPress={(event) => {
                    event.stopPropagation();
                    onTagTap?.(tag);
                  }}
                  style={[styles.tagChip, { borderColor: theme.backgroundSelected }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {tag}
                  </ThemedText>
                </Pressable>
              ))}
              {!selecting ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="添加标签"
                  onPress={(event) => {
                    event.stopPropagation();
                    onEditTags?.();
                  }}
                  style={[styles.tagChip, styles.tagAdd, { borderColor: theme.tint }]}>
                  <Ionicons name="add" size={14} color={theme.tint} />
                </Pressable>
              ) : null}
            </View>
          ) : (
            !selecting ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加标签"
                onPress={(event) => {
                  event.stopPropagation();
                  onEditTags?.();
                }}>
                <ThemedText type="small" themeColor="tint">
                  ＋ 标签
                </ThemedText>
              </Pressable>
            ) : null
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.ideaMeta}>
            {formatMonthDay(new Date(idea.createdAt))} 记下
            {converted ? ' · 已转成任务' : ''}
          </ThemedText>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: Spacing.one },
  list: { gap: Spacing.two },
  /**
   * 左滑露出的容器。圆角与行一致 + 裁切 —— 行滑开后露出的按钮才会
   * 跟着行的圆角轮廓走，而不是在角上凸出两个直角。
   */
  swipeContainer: { borderRadius: Spacing.three, overflow: 'hidden' },
  /** 一次滑出来的两个动作。父层是 row-reverse，这一排会自动贴到行的右边缘 */
  swipeActions: { flexDirection: 'row' },
  /**
   * 单个动作键：竖排图标 + 文字，占满行高。
   * ⚠️ 删除与归档刻意只差一档色（浅灰底 / 实底反白）：这套调色板刻意没有
   * 彩色强调，不为"危险"单开一个红色。会用这个界面的人认得
   * "最重的那个 = 最不能反悔的那个" —— 正是全 app 主按钮的同一个语言。
   */
  swipeAction: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  ideaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  ideaBody: { flex: 1, gap: Spacing.one },
  ideaMeta: { fontSize: 12 },
  /**
   * 标签 chip 行：换行排，跟在正文下面、日期上面。
   * chip 本体是描边小胶囊；末尾「＋」同款样式但用 tint 描边，点开编辑面板。
   */
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagAdd: { paddingHorizontal: Spacing.two },
  /** 筛选行：时间范围 chip + 当前标签，排在搜索框下面、列表上面 */
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  /** 筛选 chip（时间范围 / 标签）。选中 = 实心反白，未选中 = 描边 */
  rangeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  /**
   * 多选模式下的选中方块（整行最左侧）。选中 = 实心填 tint + 勾；
   * 没选中 = 空心描边。和任务行共用"方块代表选中"的语言（task-row 的 selectBox）。
   */
  ideaSelectBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  /**
   * 选择模式下的底部浮条（"已选 N · 删除"）。和 UndoBar 共用浮层定位，
   * 但它是操作条不是提示条，所以单独一个样式：靠上、不叠在撤销条的位置。
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
