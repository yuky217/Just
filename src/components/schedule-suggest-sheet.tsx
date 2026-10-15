import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  SCHEDULE_DAY_PARTS,
  SCHEDULE_WINDOW_OPTIONS,
  describePlan,
  describeScope,
  describeSlot,
  type SchedulePlan,
  type ScheduleScope,
} from '@/domain/schedule-suggest';
import { useTheme } from '@/hooks/use-theme';

/**
 * AI 排出来的安排 → 用户过一遍 → 才落库（2026-10-13）。
 *
 * 与「拆解」面板同一套骨架、同一条理由：**AI 出的东西不许直接进库**。
 * 它不知道你周三其实有事、也不知道哪件"今天必须交"，直接落库等于替你下结论。
 *
 * ⚠️ 名字带 `Suggest` 是为了和 `components/schedule-sheet.tsx`（单任务的
 * "安排时间"预设面板）区分开 —— 那个是**手动**给一条任务挑时间，这个是
 * **AI 批量**建议一批任务排在哪。
 *
 * 三态都能走通，没有死路：
 * 1. **生成中**：转圈 + 一句在做什么（模型要 5~15 秒，不给反馈就是"点了没反应"）。
 * 2. **生成好了**：每条摊开（任务 + 建议时段），默认全选，**可逐条取消**。
 * 3. **失败了**：显示原因 + 「再试一次」—— 排期没有本地降级，失败若只给一个
 *    "重试"，用户就卡在这儿了。
 *
 * ## 顶部那行「未来 7 天 · 全天」（2026-10-15）
 *
 * 排期条件**有默认值，可以不调**：面板一打开就按当前条件排，不想调的人
 * 一次都不用碰它。想调的人点「调整」展开两行 chips，改完立刻**重排一次** ——
 * 条件变了而结果不动，那才是"点了没反应"。
 */
export interface ScheduleSuggestSheetProps {
  visible: boolean;
  /** 当前排期条件（往后几天 / 每天哪个时段） */
  scope: ScheduleScope;
  /** 改条件。由调用方落设置（下次沿用），面板收到新的 scope 会自动重排 */
  onChangeScope: (scope: ScheduleScope) => void;
  /** 发起生成。抛错表示失败（message 是能直接给用户看的中文）。 */
  onGenerate: () => Promise<SchedulePlan[]>;
  /** 任务 id → 标题，只用来显示 */
  titleOf: (id: string) => string;
  /** 确认落库（已选中的那几条） */
  onSubmit: (plans: readonly SchedulePlan[]) => void;
  onClose: () => void;
}

export function ScheduleSuggestSheet({
  visible,
  scope,
  onChangeScope,
  onGenerate,
  titleOf,
  onSubmit,
  onClose,
}: ScheduleSuggestSheetProps) {
  const theme = useTheme();
  const [plans, setPlans] = useState<SchedulePlan[]>([]);
  /** 取消勾选的 id（默认全选，所以记"被取消的"更省事） */
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  /** 条件面板默认收着：默认值已经对了，不该一来就摊开两行让人选 */
  const [tuning, setTuning] = useState(false);

  /** `onGenerate` 每次渲染都可能是新闭包，但"打开就生成"只该在 visible/scope 变化时跑 */
  const generateRef = useRef(onGenerate);
  generateRef.current = onGenerate;

  const run = async () => {
    setPhase('loading');
    setError('');
    try {
      const list = await generateRef.current();
      setPlans(list);
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : '没排出来');
      setPhase('error');
    }
  };

  /*
    scopeKey 变了就重排（条件改了结果必须跟着动），visible 从 false 变 true 也重排。
    lastKey 保证"打开"这一次只排一次 —— 否则 visible 与 scopeKey 两个依赖
    会在打开时连着触发两遍，白白花掉一次接口调用。
  */
  const scopeKey = `${scope.windowDays}|${scope.dayPartId}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      lastKey.current = null;
      return;
    }
    if (lastKey.current === scopeKey) return;
    lastKey.current = scopeKey;
    setPlans([]);
    setDropped(new Set());
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scopeKey]);

  const toggle = (id: string) => {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = plans.filter((plan) => !dropped.has(plan.id));
  const dayPart = SCHEDULE_DAY_PARTS.find((p) => p.id === scope.dayPartId) ?? SCHEDULE_DAY_PARTS[0];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(event) => event.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <ThemedText type="smallBold" style={styles.title}>
            {phase === 'loading' ? '在替你看这一阵…' : '建议这样安排'}
          </ThemedText>

          {/* 条件行：**默认收着**。值写在这儿，不调的人只会看到一句话 */}
          <View style={[styles.scopeRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.scopeText}>
              {describeScope(scope)} · {dayPart.slots.map(describeSlot).join('、')}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="调整排期范围"
              accessibilityState={{ expanded: tuning }}
              hitSlop={6}
              onPress={() => setTuning((v) => !v)}>
              <ThemedText type="small" themeColor="tint" style={styles.tune}>
                调整
              </ThemedText>
            </Pressable>
          </View>

          {tuning ? (
            <View style={styles.tunePanel}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tuneLabel}>
                排到未来
              </ThemedText>
              <View style={styles.chips}>
                {SCHEDULE_WINDOW_OPTIONS.map((days) => (
                  <Chip
                    key={days}
                    label={`${days} 天`}
                    on={scope.windowDays === days}
                    onPress={() => onChangeScope({ ...scope, windowDays: days })}
                  />
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tuneLabel}>
                每天的时段
              </ThemedText>
              <View style={styles.chips}>
                {SCHEDULE_DAY_PARTS.map((part) => (
                  <Chip
                    key={part.id}
                    label={part.label}
                    on={scope.dayPartId === part.id}
                    onPress={() => onChangeScope({ ...scope, dayPartId: part.id })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {phase === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color={theme.text} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                结合截止与优先级给一版，等会儿你自己挑
              </ThemedText>
            </View>
          ) : null}

          {phase === 'error' ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.noticeText}>
                {error}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新排一次"
                hitSlop={6}
                onPress={() => void run()}>
                <ThemedText type="smallBold" style={styles.retry}>
                  再试一次
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {phase !== 'loading' && plans.length ? (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {plans.map((plan) => {
                const on = !dropped.has(plan.id);
                return (
                  <Pressable
                    key={plan.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${titleOf(plan.id)} ${describePlan(plan)}`}
                    onPress={() => toggle(plan.id)}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                    ]}>
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={on ? theme.tint : theme.textSecondary}
                    />
                    <View style={styles.rowText}>
                      <ThemedText type="small" numberOfLines={1}>
                        {titleOf(plan.id)}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {describePlan(plan)}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!chosen.length || phase === 'loading'}
            onPress={() => onSubmit(chosen)}
            style={({ pressed }) => [
              styles.submit,
              {
                backgroundColor: theme.text,
                opacity: chosen.length && phase !== 'loading' ? (pressed ? 0.75 : 1) : 0.35,
              },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {chosen.length ? `安排这 ${chosen.length} 条` : '还没选要安排的'}
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 条件 chip：选中 = tint 实心（与想法页的标签 chip 同一套观感） */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? theme.tint : theme.backgroundSelected,
          backgroundColor: on ? theme.tint : 'transparent',
        },
      ]}>
      <ThemedText type="small" themeColor={on ? 'background' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  title: { marginTop: Spacing.one },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  scopeText: { flex: 1, fontSize: 12 },
  tune: { fontSize: 13, fontWeight: '600' },
  tunePanel: { gap: Spacing.one },
  tuneLabel: { fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  center: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  centerText: { fontSize: 12 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  noticeText: { flex: 1, fontSize: 12 },
  retry: { fontSize: 13 },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  rowText: { flex: 1, gap: 2 },
  submit: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    marginTop: Spacing.one,
  },
});
