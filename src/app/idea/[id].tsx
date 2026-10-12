import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TagEditorSheet } from '@/components/tag-editor-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Idea } from '@/domain/idea';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatDayTime } from '@/utils/datetime';

/**
 * 想法详情。
 *
 * **点一行进的应该是这里**（2026-10-12）。此前点一行直接打开拆解面板 ——
 * 那条路把"想法"当成了"任务"来对待：拆解是把一件事切成几步，而想法连
 * "要不要做"都还没定。想法的动作是**记录 · 加标签 · 筛选 · 归档 · 转成任务**，
 * 详情页就是把这几件事收在一处。
 *
 * 出口只有一个：**转成一条任务**。想再拆细，去那条任务的详情页拆 ——
 * 拆解只属于任务，想法这边不再提供第二个拆解入口（两个入口迟早对不上）。
 *
 * 保存策略与任务/容器详情页一致：本地 state 是唯一显示源（乐观更新），
 * 改动即刻写库，不回头 reload —— 否则会跟正在输入的文本打架。
 */
export default function IdeaDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();

  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const loadIdea = useAppStore((state) => state.loadIdea);
  const saveIdea = useAppStore((state) => state.saveIdea);
  const archiveIdea = useAppStore((state) => state.archiveIdea);
  const convertIdeaToTask = useAppStore((state) => state.convertIdeaToTask);
  const allIdeas = useAppStore((state) => state.ideas);
  const tasks = useAppStore((state) => state.tasks);

  const [idea, setIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  /** 正在显示/编辑的正文。它是这一页唯一显示源，落库是它的副作用。 */
  const [content, setContent] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    void loadIdea(id).then((found) => {
      if (!alive) return;
      setIdea(found);
      setContent(found?.content ?? '');
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, loadIdea]);

  /**
   * 输入即存（沿用任务详情页那条血泪规则）。
   *
   * 只靠 onBlur 是不够的：手势返回 / 安卓返回键 / 点 Tab 都不触发失焦，
   * 那一屏字就那么没了。所以打字停下来就写一次库，失焦和离开页面时再补一次。
   */
  const contentRef = useRef('');
  contentRef.current = content;
  const ideaRef = useRef<Idea | null>(null);
  ideaRef.current = idea;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveContent = useCallback(async () => {
    const current = ideaRef.current;
    const next = contentRef.current.trim();
    // 空想法不落库：删光正文等于"这条想法没了"，那是归档/删除该干的事
    if (!current || !next || next === current.content) return;
    const saved = await saveIdea({ ...current, content: next });
    setIdea(saved);
  }, [saveIdea]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveContent();
    }, AUTOSAVE_DELAY_MS);
  }, [saveContent]);

  /** 把还挂着的改动立刻写下去。返回 Promise 是为了「转成任务」能等它写完再读库 */
  const flushContent = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    await saveContent();
  }, [saveContent]);

  const flushRef = useRef(flushContent);
  flushRef.current = flushContent;
  /** 离开页面时补一次。返回键 / 手势返回都不经过失焦，只有这里拦得住 */
  useEffect(() => () => void flushRef.current(), []);

  /** 整库标签，给编辑面板做联想 */
  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const item of allIdeas) {
      for (const tag of item.tags) count.set(tag, (count.get(tag) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [allIdeas]);

  const handleSaveTags = useCallback(
    async (tags: string[]) => {
      setEditingTags(false);
      const current = ideaRef.current;
      if (!current) return;
      const saved = await saveIdea({ ...current, tags });
      setIdea(saved);
    },
    [saveIdea],
  );

  /**
   * 转过的那条任务（没转过 / 那条任务已被删 → undefined）。
   *
   * 任务被删掉时当作"没转过" —— 不然按钮上写着"去看这条任务"，点进去是一片空白。
   */
  const convertedTaskOf = useCallback(
    (current: Idea) =>
      current.convertedTaskId ? tasks.find((task) => task.id === current.convertedTaskId) : undefined,
    [tasks],
  );

  /**
   * 转成任务。**先把正在打的字写下去** —— 否则转出去的任务拿的是上一次落库的正文，
   * 用户刚补的那半句就留在了想法里，两边不一致。
   * 已经转过的一次点击＝去看那条任务，不再建第二条。
   */
  const handleConvert = useCallback(async () => {
    const current = ideaRef.current;
    if (!current || converting) return;
    const existing = convertedTaskOf(current);
    if (existing) {
      router.push(`/task/${existing.id}`);
      return;
    }
    setConverting(true);
    await flushContent();
    const taskId = await convertIdeaToTask(current.id);
    setConverting(false);
    if (taskId) {
      // 指针已回写，重读一份让按钮变成「去看这条任务」
      const fresh = await loadIdea(current.id);
      if (fresh) setIdea(fresh);
    }
  }, [converting, convertedTaskOf, convertIdeaToTask, flushContent, loadIdea, router]);

  /**
   * 归档。**不要二次确认** —— 归档是可逆的（想法页下面的归档箱能放回来），
   * 给可逆动作加确认只是把"收起来"变难。收起来之后这页就没意义了，直接退回列表。
   */
  const handleArchive = useCallback(async () => {
    const current = ideaRef.current;
    if (!current) return;
    await flushContent();
    await archiveIdea(current.id);
    router.back();
  }, [archiveIdea, flushContent, router]);

  if (loading) {
    return (
      <Screen title="想法">
        <ThemedText type="small" themeColor="textSecondary">
          正在读取…
        </ThemedText>
      </Screen>
    );
  }

  if (!idea) {
    return (
      <Screen
        title="想法"
        right={
          <Pressable hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        }>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            这条想法已经不在了（可能刚被删掉）。
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  const converted = Boolean(convertedTaskOf(idea));
  const edited = idea.updatedAt !== idea.createdAt;

  return (
    <Screen
      title="想法"
      right={
        <Pressable hitSlop={8} accessibilityLabel="关闭" onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {/* 正文 + 标签 + 时间：这一条想法本身 */}
      <Card>
        <TextInput
          value={content}
          onChangeText={(value) => {
            setContent(value);
            scheduleSave();
          }}
          onBlur={() => {
            // 正文被清空 → 退回原文（空想法不落库，也不该在屏幕上假装它空了）
            if (!contentRef.current.trim()) setContent(idea.content);
            void flushContent();
          }}
          multiline
          placeholder="记一个念头、一点灵感…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.contentInput, { color: theme.text }]}
        />

        <View style={styles.tagRow}>
          {idea.tags.map((tag) => (
            <View
              key={tag}
              style={[styles.tagChip, { borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {tag}
              </ThemedText>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={idea.tags.length ? '改标签' : '加标签'}
            onPress={() => setEditingTags(true)}
            style={[styles.tagChip, styles.tagAdd, { borderColor: theme.tint }]}>
            <Ionicons name="add" size={14} color={theme.tint} />
            {idea.tags.length ? null : (
              <ThemedText type="small" themeColor="tint">
                标签
              </ThemedText>
            )}
          </Pressable>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {formatDayTime(idea.createdAt)} 记下
          {edited ? ` · ${formatDayTime(idea.updatedAt)} 改过` : ''}
        </ThemedText>
      </Card>

      {/*
        出口：转成一条任务。转过之后按钮变成"去看那条任务" —— 同一次点击，
        语义随状态变，不再给用户第二个选择。
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={converted ? '去看这条想法变成的任务' : '把这条想法变成一条任务'}
        onPress={() => void handleConvert()}
        style={({ pressed }) => [
          styles.primary,
          {
            backgroundColor: theme.text,
            opacity: pressed || converting ? 0.7 : 1,
          },
        ]}>
        <Ionicons
          name={converted ? 'arrow-forward' : 'add-circle-outline'}
          size={18}
          color={theme.background}
        />
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          {converted ? '去看这条任务' : converting ? '正在转…' : '转成任务'}
        </ThemedText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="归档这条想法"
        onPress={() => void handleArchive()}
        style={({ pressed }) => [
          styles.secondary,
          { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
        ]}>
        <Ionicons name="archive-outline" size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          归档
        </ThemedText>
      </Pressable>

      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        归档只是收起来：想法页最下面的归档箱里能放回来。
      </ThemedText>

      <TagEditorSheet
        visible={editingTags}
        idea={idea}
        allTags={allTags}
        onSave={(tags) => void handleSaveTags(tags)}
        onClose={() => setEditingTags(false)}
      />
    </Screen>
  );
}

const AUTOSAVE_DELAY_MS = 600;

const styles = StyleSheet.create({
  contentInput: {
    fontSize: 17,
    lineHeight: 24,
    minHeight: 96,
    padding: 0,
    textAlignVertical: 'top',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagAdd: { paddingHorizontal: Spacing.two },
  footnote: { fontSize: 12, marginTop: Spacing.two, opacity: 0.8 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hint: { fontSize: 12, textAlign: 'center', opacity: 0.8 },
});
