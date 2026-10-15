import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';

import { useSettings } from '@/state/settings-store';

/**
 * 统一的轻触觉入口。
 *
 * 只在用户拨开了「触觉反馈」开关时才响（设置页 `hapticsEnabled`，
 * 默认开）。关键动作才给一次：勾选、打卡、保存、开始专注；
 * 列表滚动 / 展开收起 / 切 Tab 一律不给 —— 触觉和通知一样，
 * 一旦泛滥用户只会去系统里关掉整个应用，那时连该响的也不响了。
 *
 * 全部 fire-and-forget：触觉失败（设备不支持等）直接吞掉，
 * 绝不能因为它卡住主流程（记一条、勾一下都还得继续）。
 */
export type HapticKind = 'light' | 'success';

export function useHaptics(): (kind?: HapticKind) => void {
  const enabled = useSettings((state) => state.hapticsEnabled);
  return useCallback(
    (kind: HapticKind = 'light') => {
      if (!enabled) return;
      // expo-haptics 在 web 上是空操作，直接跳过，避免在浏览器的导出预览里
      // 白白走一遍 Promise（原先 capture-success 也是这么回避 web 的）
      if (Platform.OS === 'web') return;
      if (kind === 'success') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    },
    [enabled],
  );
}
