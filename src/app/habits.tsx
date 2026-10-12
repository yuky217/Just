import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { CheckinHeatmap } from '@/components/checkin-heatmap';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  buildHeatmap,
  describeStreak,
  hasCheckedInOn,
  summarizeCheckins,
} from '@/domain/checkins';
import { describeProgress } from '@/domain/focus-link';
import { occurrencesInPeriod } from '@/domain/habit-period';
import {
  buildHabitConversion,
  canConvertToHabit,
  HABIT_CADENCE_PRESETS,
  type HabitCadence,
} from '@/domain/habit-convert';
import { CompletionRule } from '@/domain/enums';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 习惯打卡。
 *
 * 为什么不占一个 Tab：习惯是"每天/每周去做一次"，不是"今天必须处理的一批事"，
 * 它不该跟任务抢导航位（跟纪念日同理）。首页给一张卡做入口，全部在这里管。
 *
 * 与任务的关系（重要）：
 * - 任务状态回答"这件事还做不做"；
 * - 打卡记录回答"今天做没做"。
 * 所以打卡**不会**把习惯标成完成、不会让它从列表消失 —— 明天它还得出现。
 * 唯一例外是有明确次数目标的频率型习惯（"每周跑 3 次"）：那种情况下
 * "本期做了几次"是从打卡记录**现算**的（`domain/habit-period`），
 * 够数由 state 层在 refresh 前统一对账，新的一周会自动回到待办。
 *
 * ## 「新建习惯」为什么在这一页（2026-10-13）
 *
 * 以前这里没有新建入口，空态写的是"在首页记一条，把类型设成「习惯」" ——
 * 也就是**建一个习惯要走三步**：记一条 → 进详情页 → 把类型改成习惯。
 * 而用户想的是"我要加一个习惯"，那件事应该在这一页一句话说完。
 * 现在右上角一个「＋」：起个名字、挑个节奏，落库走的是与详情页**同一套**转换
 * （`buildHabitConversion`）—— 口径只有一份，不会两处长出两种习惯。
 */
const HEATMAP_DAYS = 70;
const HEATMAP_WEEKS = 10;

export default function HabitsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ new?: string | string[] }>();
  const rawNew = params.new;
  const startCreating = (Array.isArray(rawNew) ? rawNew[0] : rawNew) === '1';

  const habits = useAppStore((state) => state.habits);
  const checkins = useAppStore((state) => state.checkins);
  const checkIn = useAppStore((state) => state.checkIn);
  const undoCheckIn = useAppStore((state) => state.undoCheckIn);
  const capture = useAppStore((state) => state.capture);
  const loadTask = useAppStore((state) => state.loadTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const [busyId, setBusyId] = useState<string | null>(null);

  /*
    新建习惯：一个输入框 + 一组节奏。默认值是「每天 1 次」——
    那是最常见的那种习惯（跑步、读书、喝水），也是对的默认：用户不改就是对的。
  */
  const [creating, setCreating] = useState(startCreating);
  const [draft, setDraft] = useState('');
  const [cadenceIndex, setCadenceIndex] = useState(0);
  const [creatingBusy, setCreatingBusy] = useState(false);

  /** 从首页「＋」深链进来（`/habits?new=1`）时直接把面板打开 */
  useEffect(() => {
    if (startCreating) setCreating(true);
  }, [startCreating]);

  /**
   * 落库：先按普通方式记一条（复用入口层唯一那条记录路径），再把它转成习惯。
   *
   * 顺序与任务详情页的「转为习惯」一致 —— 转换真的只是"给一条已存在的任务
   * 换判定域"，所以不存在"另一条创建习惯的路"，也就不会两处跑偏。
   */
  const createHabit = useCallback(async () => {
    const title = draft.trim();
    if (!title || creatingBusy) return;
    setCreatingBusy(true);
    try {
      const created = await capture({ text: title });
      const task = await loadTask(created.id);
      if (task && canConvertToHabit(task)) {
        const preset = HABIT_CADENCE_PRESETS[cadenceIndex] ?? HABIT_CADENCE_PRESETS[0];
        const plan = buildHabitConversion(task, {
          cadence: preset.cadence,
          targetOccurrences: preset.target,
          // 刚建出来的一条必然还没完成过，不必去补那天的打卡
          countExistingCompletion: false,
        });
        await updateTask(created.id, plan.patch);
      }
      setCreating(false);
      setDraft('');
      setCadenceIndex(0);
    } finally {
      setCreatingBusy(false);
    }
  }, [draft, creatingBusy, cadenceIndex, capture, loadTask, updateTask]);

  /** 每个习惯的打卡日集合，避免在渲染里反复 filter 整份记录 */
  const keysByTask = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const record of checkins) {
      const bucket = map.get(record.taskId) ?? [];
      bucket.push(record.dayKey);
      map.set(record.taskId, bucket);
    }
    return map;
  }, [checkins]);

  const today = new Date();

  const stats = useMemo(
    () =>
      habits.map((habit) => {
        const keys = keysByTask.get(habit.id) ?? [];
        return {
          habit,
          keys,
          streak: summarizeCheckins(keys, today),
          doneToday: hasCheckedInOn(keys, today),
          // 频率型的"本期几次"从打卡记录现算，不读任何计数器（见 domain/habit-period）
          periodCount:
            habit.completion === CompletionRule.Frequency
              ? occurrencesInPeriod(keys, habit.repeat, today)
              : 0,
        };
      }),
    // today 每次渲染都是新对象，用日期字符串代替依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, keysByTask, today.toDateString()],
  );

  const doneCount = stats.filter((s) => s.doneToday).length;

  const toggle = async (habit: Task, doneToday: boolean) => {
    setBusyId(habit.id);
    try {
      if (doneToday) await undoCheckIn(habit.id);
      else await checkIn(habit.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen
      title="习惯"
      subtitle={
        habits.length ? `今天已打卡 ${doneCount}/${habits.length}` : '一次一次累积出来的东西'
      }
      right={
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建习惯"
            hitSlop={8}
            onPress={() => setCreating(true)}>
            <Ionicons name="add" size={24} color={theme.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>
      }>
      {!habits.length ? (
        <EmptyState
          icon="repeat-outline"
          title="还没有习惯"
          hint="点右上角的「＋」，给它起个名字就行（比如「每天早上跑步 30 分钟」）"
        />
      ) : null}

      {stats.map(({ habit, keys, streak, doneToday, periodCount }) => (
        <Card key={habit.id}>
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/task/${habit.id}`)}
              style={styles.headText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {habit.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {describeStreak(streak)}
                {streak.longest > 0 ? ` · 最长 ${streak.longest} 天` : ''}
                {` · 共 ${streak.total} 次`}
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ checked: doneToday }}
              accessibilityLabel={doneToday ? '撤销今天的打卡' : '今天打卡'}
              disabled={busyId === habit.id}
              onPress={() => void toggle(habit, doneToday)}
              style={[
                styles.checkButton,
                {
                  backgroundColor: doneToday ? theme.text : 'transparent',
                  borderColor: doneToday ? theme.text : theme.textSecondary,
                  opacity: busyId === habit.id ? 0.5 : 1,
                },
              ]}>
              <Ionicons
                name={doneToday ? 'checkmark' : 'add'}
                size={16}
                color={doneToday ? theme.background : theme.textSecondary}
              />
              <ThemedText
                type="small"
                style={{ color: doneToday ? theme.background : theme.textSecondary }}>
                {doneToday ? '今天已打卡' : '今天打卡'}
              </ThemedText>
            </Pressable>
          </View>

          {describeProgress(habit, periodCount) ? (
            <ThemedText type="small" themeColor="textSecondary">
              {describeProgress(habit, periodCount)}
            </ThemedText>
          ) : null}

          <CheckinHeatmap
            cells={buildHeatmap(keys, HEATMAP_DAYS, today)}
            weeks={HEATMAP_WEEKS}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.legend}>
            最近 {HEATMAP_DAYS} 天，深色 = 打过卡
          </ThemedText>
        </Card>
      ))}

      {/*
        新建习惯：一个名字 + 一组节奏，两下就完（默认「每天 1 次」是最常见的那种，
        不改就是对的默认）。刻意**不**在这里问"提醒 / 时间 / 归属" ——
        那些详情页里都能补，而"我要加一个习惯"这件事本身只有这两项。
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
              <ThemedText type="smallBold" style={styles.sheetTitle}>
                新建习惯
              </ThemedText>

              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
                ]}>
                <TextInput
                  autoFocus
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={() => void createHabit()}
                  placeholder="比如：每天早上跑步"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  style={[styles.input, { color: theme.text }]}
                />
              </View>

              <View style={styles.chipRow}>
                {HABIT_CADENCE_PRESETS.map((preset, index) => {
                  const active = index === cadenceIndex;
                  return (
                    <Pressable
                      key={preset.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setCadenceIndex(index)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.text : 'transparent',
                          borderColor: active ? theme.text : theme.backgroundSelected,
                        },
                      ]}>
                      <ThemedText
                        type="small"
                        style={{ color: active ? theme.background : theme.textSecondary }}>
                        {preset.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="创建习惯"
                disabled={!draft.trim() || creatingBusy}
                onPress={() => void createHabit()}
                style={[
                  styles.createButton,
                  {
                    backgroundColor: theme.text,
                    opacity: draft.trim() && !creatingBusy ? 1 : 0.4,
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  {creatingBusy ? '创建中…' : '创建'}
                </ThemedText>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headText: { flex: 1, gap: 2 },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: 1.2,
  },
  legend: { fontSize: 11, lineHeight: 15, opacity: 0.8 },
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.two },
  sheetTitle: { textAlign: 'center' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  createButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
});
