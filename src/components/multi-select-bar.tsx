import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface MultiSelectBarProps {
  /** 已选中的条数 */
  count: number;
  /** 点「删除」 */
  onDelete: () => void;
  /**
   * 可选的「排期」动作（待办页有，想法页没有）。传了才显示这一项。
   * 用于把一组任务一次性排到某天。
   */
  onSchedule?: () => void;
  /** 「排期」按钮的文案，默认「排期」 */
  scheduleLabel?: string;
  /**
   * 可选的「帮我排」（AI 只排勾选的这几条，2026-10-15）。
   *
   * 只在**勾中的确有"还没排时间"的任务**时才传 —— 已经有时间的不用再排，
   * 一个点了必然说"没有需要安排的任务"的按钮是界面在承诺做不到的事。
   */
  onSuggest?: () => void;
}

/**
 * 多选模式下的底部操作条（"已选 N · 排期 · 删除"）。
 *
 * 待办页与想法页**共用**这一条（2026-10-15）：两处都是"选中一批 → 删除/排期"，
 * 各自写一遍只会长出两份会漂移的样式。它只负责画操作条，撤销交给各自的 UndoBar。
 *
 * 不自动消失：它跟着选择模式走，退出选择才收起。
 */
export function MultiSelectBar({
  count,
  onDelete,
  onSchedule,
  scheduleLabel = '排期',
  onSuggest,
}: MultiSelectBarProps) {
  const theme = useTheme();
  return (
    <View
      style={[styles.bar, { backgroundColor: theme.backgroundElement }]}
      accessibilityRole="toolbar">
      <ThemedText type="small" themeColor="text">
        已选 {count}
      </ThemedText>
      <View style={styles.actions}>
        {onSuggest ? (
          // 带图标：它是这批按钮里唯一"让 AI 替你想"的动作，跟另外两个"你说了算"的分开
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="让 AI 排这几条"
            hitSlop={6}
            onPress={onSuggest}
            style={styles.suggestAction}>
            <Ionicons name="sparkles-outline" size={14} color={theme.tint} />
            <ThemedText type="small" themeColor="tint" style={styles.action}>
              帮我排
            </ThemedText>
          </Pressable>
        ) : null}
        {onSchedule ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scheduleLabel}
            onPress={onSchedule}>
            <ThemedText type="small" themeColor="tint" style={styles.action}>
              {scheduleLabel}
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="删除选中的"
          onPress={onDelete}>
          <ThemedText type="small" themeColor="tint" style={styles.action}>
            删除
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  suggestAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { fontWeight: '600' },
});
