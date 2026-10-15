import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/card';
import { ChoiceSheet } from '@/components/choice-sheet';
import { ContainerRow } from '@/components/container-row';
import type { Container } from '@/domain/container';
import { EmptyState } from '@/components/empty-state';
import { GanttChart } from '@/components/gantt-chart';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { CONTAINER_KIND_LABEL, containerStats, DEFAULT_CONTAINER_KIND, type ContainerStats } from '@/domain/container-stats';
import { ContainerKind, ContainerStatus } from '@/domain/enums';
import type { GanttItem } from '@/domain/gantt';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 项目 / 目标 / 文件夹（主文档 3.1 本体层里的"项目 / 目标"）。
 *
 * 三者是同一种实体的三种类型（主文档 5.3 的"容器"），只有语义差别：
 * - **目标**：远处的方向（"今年把英语练到能开会"）；
 * - **项目**：有始有终的一摊事（"搬家"），通常带起止时间，会进甘特图；
 * - **文件夹**：纯分类（"工作 / 生活"），不参与进度汇总。
 *
 * 甘特图在这里是**视图**而不是新实体：它读的就是容器的 startAt/endAt
 * 加上成员任务的时间，没有自己的表、自己的状态。
 *
 * ⭐ 新建入口（2026-10-13）：页头一枚「＋」+ 一块贴底的面板。
 * 以前「＋」点开的是一张**整宽卡片**压在最上面，把列表整个推下去又弹回来；
 * 而"建一个新摊子"只值一个名字加一个类型 —— 犯不上占掉上方一整栏。
 */
const KIND_ORDER: ContainerKind[] = [ContainerKind.Goal, ContainerKind.Project];

export default function ProjectsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const containers = useAppStore((state) => state.containers);
  const tasks = useAppStore((state) => state.tasks);
  const createContainer = useAppStore((state) => state.createContainer);
  const removeContainer = useAppStore((state) => state.removeContainer);
  const removeContainerDeep = useAppStore((state) => state.removeContainerDeep);
  const updateContainer = useAppStore((state) => state.updateContainer);
  const shiftTaskByDays = useAppStore((state) => state.shiftTaskByDays);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ContainerKind>(DEFAULT_CONTAINER_KIND);
  /** 甘特图拖拽期间锁住页面滚动 */
  const [ganttDragging, setGanttDragging] = useState(false);
  /** 长按某行弹出的操作菜单：指向被按的那一行 */
  const [menuFor, setMenuFor] = useState<Container | null>(null);
  /** 改名弹窗 */
  const [renaming, setRenaming] = useState<Container | null>(null);
  const [renameText, setRenameText] = useState('');
  /** 删除确认弹窗 */
  const [deleting, setDeleting] = useState<Container | null>(null);

  /** 长按菜单的选项：改名 / 标记完成或重开 / 删除（删项目只解绑任务） */
  const menuOptions = useMemo(() => {
    if (!menuFor) return [];
    const done = menuFor.status === ContainerStatus.Done;
    return [
      { key: 'rename', label: '改名' },
      { key: 'toggle', label: done ? '重新开始' : '标记完成' },
      { key: 'delete', label: '删除', hint: '项目会被删掉' },
    ];
  }, [menuFor]);

  const onMenuSelect = (key: string) => {
    const target = menuFor;
    setMenuFor(null);
    if (!target) return;
    if (key === 'rename') {
      setRenameText(target.title);
      setRenaming(target);
    } else if (key === 'toggle') {
      const done = target.status === ContainerStatus.Done;
      void updateContainer(target.id, { status: done ? ContainerStatus.Active : ContainerStatus.Done });
    } else if (key === 'delete') {
      setDeleting(target);
    }
  };

  /** 每个容器的进度：直属任务算，不递归子容器（见 domain/container-stats.ts） */
  const statsByContainer = useMemo(() => {
    const map = new Map<string, ContainerStats>();
    const buckets = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.containerId) continue;
      const bucket = buckets.get(task.containerId) ?? [];
      bucket.push(task);
      buckets.set(task.containerId, bucket);
    }
    for (const [id, bucket] of buckets) {
      map.set(id, containerStats(bucket));
    }
    return map;
  }, [tasks]);

  const childCountByContainer = useMemo(() => {
    const map = new Map<string, number>();
    for (const container of containers) {
      if (!container.parentId) continue;
      map.set(container.parentId, (map.get(container.parentId) ?? 0) + 1);
    }
    return map;
  }, [containers]);

  /** 甘特图数据：容器自己的周期 + 归属它的任务的时间 */
  const ganttItems = useMemo<GanttItem[]>(() => {
    const items: GanttItem[] = [];
    for (const container of containers) {
      if (!container.startAt && !container.endAt) continue;
      items.push({
        id: container.id,
        label: container.title,
        kind: 'container',
        startAt: container.startAt,
        endAt: container.endAt,
        done: container.status !== 'active',
        badge: CONTAINER_KIND_LABEL[container.kind],
      });
    }
    for (const task of tasks) {
      if (!task.containerId) continue;
      if (!task.time.startAt && !task.time.dueAt) continue;
      items.push({
        id: task.id,
        label: task.title,
        kind: 'task',
        startAt: task.time.startAt,
        endAt: task.time.endAt,
        dueAt: task.time.dueAt,
        done: task.status === 'done',
      });
    }
    return items;
  }, [containers, tasks]);

  const submit = async () => {
    const next = title.trim();
    if (!next) return;
    const created = await createContainer({ title: next, kind });
    setTitle('');
    setCreating(false);
    router.push(`/container/${created.id}`);
  };

  return (
    <Screen
      /* 没有页头（2026-10-10）：底部 Tab 栏已经写着「项目」 */
      scrollEnabled={!ganttDragging}
      right={
        /*
          新建入口就只有这一枚「＋」（2026-10-13 用户点名）。
          以前它点开是一张**整宽卡片**压在最上面：表单把下面的列表整个推下去，
          关掉又弹回来 —— 而"建一个项目"只值一个名字加一个类型，
          犯不上占掉上方一整栏。现在它拉起来一块贴底的面板（与习惯页同一副骨架）。
        */
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="新建目标或项目"
          onPress={() => setCreating(true)}>
          <Ionicons name="add" size={24} color={theme.text} />
        </Pressable>
      }>
      {!containers.length ? (
        <Card>
          <EmptyState
            icon="albums-outline"
            title="还没有目标或项目"
            hint="点右上角的加号建一个，把散着的任务收进去，进度就看得见了"
          />
        </Card>
      ) : null}

      {KIND_ORDER.map((groupKind) => {
        const group = containers.filter((container) => container.kind === groupKind && !container.parentId);
        if (!group.length) return null;
        return (
          <Card key={groupKind} title={CONTAINER_KIND_LABEL[groupKind]} hint={`${group.length} 个`}>
            {group.map((container) => (
              <ContainerRow
                key={container.id}
                container={container}
                stats={statsByContainer.get(container.id) ?? containerStats([])}
                childCount={childCountByContainer.get(container.id) ?? 0}
                onPress={(target) => router.push(`/container/${target.id}`)}
                onLongPress={(target) => setMenuFor(target)}
              />
            ))}
          </Card>
        );
      })}

      {ganttItems.length ? (
        <Card title="时间轴" hint="容器与成员任务排在同一条轴上，竖线是今天">
          <GanttChart
            items={ganttItems}
            onDragStateChange={setGanttDragging}
            onReschedule={(item, days) => void shiftTaskByDays(item.id, days)}
            onSelect={(item) => {
              if (item.kind === 'container') router.push(`/container/${item.id}`);
              else router.push(`/task/${item.id}`);
            }}
          />
        </Card>
      ) : null}

      {/* 长按行弹出的操作菜单：改名 / 标记完成 / 删除，都不用点进详情页 */}
      <ChoiceSheet
        visible={menuFor !== null}
        title={menuFor ? menuFor.title : ''}
        options={menuOptions}
        onSelect={onMenuSelect}
        onClose={() => setMenuFor(null)}
      />

      {/* 改名弹窗 */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setRenaming(null)}>
          <Pressable
            style={[styles.sheetBox, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}>
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              改名
            </ThemedText>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              placeholder="名字"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (renaming && renameText.trim()) {
                  void updateContainer(renaming.id, { title: renameText.trim() });
                  setRenaming(null);
                }
              }}
              style={[
                styles.sheetInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
              ]}
            />
            <View style={styles.sheetActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRenaming(null)}
                style={[styles.sheetBtn, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  取消
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (renaming && renameText.trim()) {
                    void updateContainer(renaming.id, { title: renameText.trim() });
                    setRenaming(null);
                  }
                }}
                style={[styles.sheetBtn, { backgroundColor: theme.text }]}>
                <ThemedText type="small" style={{ color: theme.background }}>
                  保存
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 删除确认弹窗：这一步才决定「只解绑」还是「连任务一起删」—— 不替用户下结论 */}
      <Modal visible={deleting !== null} transparent animationType="fade" onRequestClose={() => setDeleting(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setDeleting(null)}>
          <Pressable
            style={[styles.sheetBox, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}>
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              删除「{deleting?.title}」？
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sheetHint}>
              两种删法，任务不会凭空消失——只是要不要一起带走
            </ThemedText>
            <View style={styles.sheetActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (deleting) void removeContainer(deleting.id);
                  setDeleting(null);
                }}
                style={[styles.sheetBtn, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  只删项目 · 任务保留
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (deleting) void removeContainerDeep(deleting.id);
                  setDeleting(null);
                }}
                style={[styles.sheetBtn, { backgroundColor: '#c0392b' }]}>
                <ThemedText type="small" style={{ color: '#ffffff' }}>
                  连任务一起删
                </ThemedText>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDeleting(null)}
              style={[styles.sheetBtn, { backgroundColor: theme.backgroundSelected, marginTop: Spacing.two }]}>
              <ThemedText type="small" themeColor="textSecondary">
                取消
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/*
        新建目标 / 项目：页头「＋」拉起来的那块面板。
        只问两件事 —— 名字、类型（默认「项目」，最常见的那个，不改就是对的）。
        起止时间、归属、甘特图都不在这儿问：那些是建完之后在容器页里慢慢补的东西，
        而"我要开一个新摊子"这件事本身只有这两项。
      */}
      <Modal
        visible={creating}
        transparent
        animationType="slide"
        onRequestClose={() => setCreating(false)}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setCreating(false)}>
            <Pressable
              style={[styles.sheet, { backgroundColor: theme.background }]}
              onPress={(event) => event.stopPropagation()}>
              <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
              <ThemedText type="smallBold" style={[styles.sheetTitle, { textAlign: 'center' }]}>
                新建
              </ThemedText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="给它起个名字"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
              <View style={styles.chips}>
                {KIND_ORDER.map((option) => {
                  const active = kind === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setKind(option)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.text : theme.background,
                          borderColor: active ? theme.text : theme.backgroundSelected,
                        },
                      ]}>
                      <ThemedText
                        type="small"
                        style={{ color: active ? theme.background : theme.text }}>
                        {CONTAINER_KIND_LABEL[option]}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="建好"
                disabled={!title.trim()}
                onPress={() => void submit()}
                style={[
                  styles.createButton,
                  { backgroundColor: theme.text, opacity: title.trim() ? 1 : 0.4 },
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  建好
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                目标看方向、项目看进度
              </ThemedText>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** 新建面板（贴底那块）：与习惯页同一副骨架 */
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  createButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footnote: { fontSize: 12, lineHeight: 16, opacity: 0.8 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  sheetBox: { width: '100%', maxWidth: 360, borderRadius: Spacing.four, padding: Spacing.three, gap: Spacing.two },
  sheetTitle: { marginBottom: Spacing.one },
  sheetHint: { lineHeight: 18 },
  sheetInput: { borderRadius: Spacing.two, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  sheetActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  sheetBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
});
