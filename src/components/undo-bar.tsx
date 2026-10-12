import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface UndoBarProps {
  /** 是否出现。隐藏时直接不渲染，不占位 */
  visible: boolean;
  /** 被删的条数，用于文案 */
  count: number;
  /** 点「撤销」：整批恢复（任务 + 子任务挂回 + 打卡 + 重排提醒） */
  onUndo: () => void;
  /** 点「×」或自动忽略：收起这条提示，撤销机会随之消失 */
  onDismiss: () => void;
}

/**
 * 删除后的可撤销提示条。
 *
 * ⚠️ **不自动消失**：撤销机会一旦被计时器吃掉，用户就没法反悔了。
 * 它停在页面底部，直到用户「撤销」或手动「×」关掉，或切走这一页。
 */
export function UndoBar({ visible, count, onUndo, onDismiss }: UndoBarProps) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="text" style={styles.text}>
        {count > 0 ? `已删 ${count} 条` : '已删除'}
      </ThemedText>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="不再提示"
          hitSlop={8}
          onPress={onDismiss}>
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="撤销删除"
          hitSlop={8}
          onPress={onUndo}>
          <ThemedText type="small" themeColor="tint" style={styles.action}>
            撤销
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
    // 压在列表之上，但别太抢：和卡片同色系、靠阴影浮起
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { flexShrink: 1 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  action: { fontWeight: '600' },
});
