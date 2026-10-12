import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { BreakdownSheet } from '@/components/breakdown-sheet';
import { IdeaBreakdownSheet } from '@/components/idea-breakdown-sheet';
import { TagEditorSheet } from '@/components/tag-editor-sheet';
import { isCapabilityReady, suggestBreakdown } from '@/capabilities/client';
import { AiCapability } from '@/capabilities/types';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UndoBar } from '@/components/undo-bar';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { Idea } from '@/domain/idea';
import type { IdeaDeleteUndo } from '@/domain/bulk-delete';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { selectCapabilityGate, useSettings } from '@/state/settings-store';
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
  /** 从全库搜索跳过来时带着关键词（`/ideas?q=…`），落地就先替用户填上 */
  const params = useLocalSearchParams<{ q?: string }>();

  const ideas = useAppStore((state) => state.ideas);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const capture = useAppStore((state) => state.capture);
  const tasks = useAppStore((state) => state.tasks);
  const breakdownIdea = useAppStore((state) => state.breakdownIdea);
  const archiveIdea = useAppStore((state) => state.archiveIdea);
  const loadArchivedIdeas = useAppStore((state) => state.loadArchivedIdeas);
  const unarchiveIdea = useAppStore((state) => state.unarchiveIdea);
  const removeIdea = useAppStore((state) => state.removeIdea);
  const removeIdeasAction = useAppStore((state) => state.removeIdeas);
  const undoDeleteIdeasAction = useAppStore((state) => state.undoDeleteIdeas);
  const saveIdea = useAppStore((state) => state.saveIdea);

  const [keyword, setKeyword] = useState('');
  /** 正在拆的那条想法（null = 面板没开） */
  const [breaking, setBreaking] = useState<Idea | null>(null);
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

  /*
    这一页是 Tab，可能早就挂载着 —— 所以不能只在 useState 初值里读一次 q：
    从搜索页跳过来时页面已经在了，得跟着参数变。
  */
  useEffect(() => {
    const q = params.q;
    if (typeof q === 'string' && q) setKeyword(q);
  }, [params.q]);

  /**
   * 每条任务底下有几个子任务 —— 想法行要说"我拆成了几步"。
   *
   * 现算而不是存在想法上：步数是子任务表的实时事实，
   * 用户去任务详情页删掉一步，存下来的数字就开始骗人了。
   */
  const subtaskCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (!task.parentId) continue;
      map.set(task.parentId, (map.get(task.parentId) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

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

  /** 已拆出来的那条父任务。父任务被删掉时当作"没拆过"—— 否则点进去是一片空白 */
  const parentOf = useCallback(
    (idea: Idea) => (idea.breakdownTaskId ? tasks.find((t) => t.id === idea.breakdownTaskId) : undefined),
    [tasks],
  );

  /**
   * 点一行：没拆过 → 打开拆解面板；拆过 → 去看那条任务。
   *
   * 拆过之后**不再让拆第二次**：追加步骤走任务详情页已有的子任务能力，
   * 那才是唯一入口。同一件事开两条路，最后一定会出现"从这边加的和从那边加的对不上"。
   */
  /*
   * AI 拆解开着时，点一行走 **AI 面板**（`BreakdownSheet`）—— 它本来就能自己写，
   * 所以不需要再给用户一个「帮我拆 / 我自己写」的选择：选哪条路是我们要替他决定的。
   * 能力没开就走原来的手写面板，两个入口的落库出口是同一个 `breakdownIdea`。
   */
  const gate = useSettings(selectCapabilityGate);
  const canAiBreakdown = isCapabilityReady(gate, AiCapability.Breakdown);

  const generateBreakdown = async (): Promise<string[]> => {
    if (!breaking) return [];
    const res = await suggestBreakdown(gate, breaking.content);
    return res.steps;
  };

  const openIdea = (idea: Idea) => {
    const parent = parentOf(idea);
    if (parent) {
      router.push(`/task/${parent.id}`);
      return;
    }
    setBreaking(idea);
  };

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

  const visible = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return ideas.filter((idea) => {
      // 标签筛选：点了一个标签就只看带它的
      if (activeTag && !idea.tags.includes(activeTag)) return false;
      // 关键词：正文或标签里出现都算（和全库搜索口径一致）
      if (k) {
        const hit =
          idea.content.toLowerCase().includes(k) ||
          idea.tags.some((t) => t.toLowerCase().includes(k));
        if (!hit) return false;
      }
      return true;
    });
  }, [ideas, keyword, activeTag]);

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

      {visible.length ? (
        <View style={styles.list}>
          {visible.map((idea) => {
            const parent = parentOf(idea);
            return (
              <IdeaRow
                key={idea.id}
                idea={idea}
                stepCount={parent ? (subtaskCount.get(parent.id) ?? 0) : 0}
                selecting={selectingIdeas}
                selected={selectedIdeaIds.has(idea.id)}
                onToggleSelect={toggleSelectIdea}
                onOpen={() => openIdea(idea)}
                onArchive={(id) => void archiveIdea(id)}
                onTagTap={filterByTag}
                onEditTags={() => openTagEditor(idea)}
              />
            );
          })}
        </View>
      ) : null}

      {/*
        正在按标签筛选时，列表上方给一条可清除的筛选条。
        点筛选条本身 = 取消筛选；它和搜索框是两套正交的过滤，互不覆盖。
      */}
      {activeTag ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`取消按标签「${activeTag}」筛选`}
          onPress={clearFilter}
          style={[
            styles.filterBar,
            { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
          ]}>
          <Ionicons name="pricetag-outline" size={14} color={theme.tint} />
          <ThemedText type="small" themeColor="tint">
            {activeTag}
          </ThemedText>
          <Ionicons name="close" size={14} color={theme.textSecondary} />
        </Pressable>
      ) : null}

      {/*
        空态。原本放在 visible.length 为假时渲染，但筛选/搜索都可能让列表变空，
        所以单独判断：要么"库本来就是空的"，要么"当前过滤条件下没有匹配"。
      */}
      {visible.length ? null : (
        <EmptyState
          icon="bulb-outline"
          title={keyword || activeTag ? '没有匹配的想法' : '想法库还是空的'}
          hint={keyword || activeTag ? '换个说法或清掉筛选' : '随手记一句，将来的你会感谢现在的你'}
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
        拆解面板。交出去之后**不跳走** —— 行上立刻多出「已拆成 N 步」，
        那行本身就是回执；跳进任务详情会把"接着拆下一条想法"打断。
      */}
      {canAiBreakdown ? (
        <BreakdownSheet
          visible={breaking !== null}
          subject={breaking?.content ?? ''}
          onGenerate={generateBreakdown}
          onClose={() => setBreaking(null)}
          onSubmit={(steps) => {
            const target = breaking;
            setBreaking(null);
            if (target) void breakdownIdea(target.id, steps);
          }}
        />
      ) : (
        <IdeaBreakdownSheet
          visible={breaking !== null}
          idea={breaking}
          onClose={() => setBreaking(null)}
          onSubmit={(steps) => {
            const target = breaking;
            setBreaking(null);
            if (target) void breakdownIdea(target.id, steps);
          }}
        />
      )}

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
  stepCount,
  selecting = false,
  selected = false,
  onToggleSelect,
  onOpen,
  onArchive,
  onTagTap,
  onEditTags,
}: {
  idea: Idea;
  /** 已经拆出来的步数（0 = 还没拆） */
  stepCount: number;
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
          : stepCount
            ? `去看「${idea.content}」拆出来的任务`
            : `把「${idea.content}」拆成能动手的几步`
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
          {stepCount ? ` · 已拆成 ${stepCount} 步` : ''}
        </ThemedText>
      </View>
      {/*
        归档按钮在内层。web 上 click 会冒泡，不拦一下的话点归档会顺带把拆解面板打开
        （原生上内层本来就赢得手势，这一句是两端的统一保险）。
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
  /** 按标签筛选时的可清除筛选条（列表上方） */
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
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
