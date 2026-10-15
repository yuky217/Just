import type { ComponentProps } from 'react';

import type { Ionicons } from '@expo/vector-icons';
import type { TabKey } from '@/domain/features';

/**
 * 底栏图标 —— 与顺序、开关分开放在这里，因为它们属于**画法**，
 * 不是口径（`domain/features.ts` 只管"谁在前、谁不出现"）。
 *
 * 图标只在这一处定义：底栏和设置页的「Tab 顺序」列表画的是同一颗，
 * 用户在设置里看见的那一行得跟他天天点的那个长得一样，否则他认不出自己在排什么。
 */
export type TabIconName = ComponentProps<typeof Ionicons>['name'];

export const TAB_ICON: Record<TabKey, TabIconName> = {
  inbox: 'file-tray-outline',
  calendar: 'calendar-outline',
  index: 'today-outline',
  projects: 'albums-outline',
  ideas: 'bulb-outline',
};
