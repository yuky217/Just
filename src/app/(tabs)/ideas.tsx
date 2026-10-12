import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

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
  const removeIdea = useAppStore((state) => state.removeIdea);
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
  const [ideaUndoToken, setIdeaUndoToken] = useState<IdeaDeleteUndo | null>(null);

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
      setIdeaUndoToken(undo);
    });
  }, [selectedIdeaIds, removeIdeasAction, exitSelectIdeas]);
  const undoDeleteIdeas = useCallback(() => {
    if (!ideaUndoToken) return;
    void undoDeleteIdeasAction(ideaUndoToken).then(() => setIdeaUndoToken(null));
  }, [ideaUndoToken, undoDeleteIdeasAction]);

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
            visible={ideaUndoToken !== null}
            count={ideaUndoToken ? ideaUndoToken.ids.length : 0}
            onUndo={undoDeleteIdeas}
            onDismiss={() => setIdeaUndoToken(null)}
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
              onArchive={(id) => void archiveIdea(id)}
              onTagTap={filterByTag}
              onEditTags={() => openTagEditor(idea)}
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
                  onPress={() => void removeIdea(idea.id)}>
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
  onTagTap,
  onEditTags,
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
  /** 点标签 chip = 按这个标签筛选 */
  onTagTap?: (tag: string) => void;
  /** 点「＋标签」= 打开编辑面板 */
  onEditTags?: () => void;
}) {
  const theme = useTheme();
  const handlePress = () => {
    if (selecting) onToggleSelect?.(idea);
    else onOpen();
  };
  return (
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
      {/*
        归档按钮在内层。web 上 click 会冒泡，不拦一下的话点归档会顺带把整行的
        "打开详情"也触发了（原生上内层本来就赢得手势，这一句是两端的统一保险）。
      */}
      {!selecting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="归档这条想法（可以在下面的归档箱里找回来）"
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onArchive(idea.id);
          }}>
          <Ionicons name="archive-outline" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
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
