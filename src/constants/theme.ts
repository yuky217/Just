import '@/global.css';

import { Platform } from 'react-native';

/**
 * 全应用的颜色令牌。走「纸与墨」：暖调纸面 + 近黑墨字 + **一种**赭色强调。
 *
 * 三条规矩，改色时别破：
 *   ① **一个强调色，只用在"这个 app 在说话"的地方**（链接、可点的「＋」、筛选生效）。
 *      别让它铺到背景和按钮上去 —— 主按钮永远是**文字色实底**，那是全 app 最重的语言。
 *      强调色之所以有分量，全靠用得少。
 *   ② **中性面要分得开**。纸 → 块 → 选中，三级之间的差是"一眼能看出来"的量级。
 *      差太小的话，层级实际上由"看起来灰不灰"决定，谁都说不准哪块是块。
 *   ③ **别用冷色点缀暖面**。之前 tint 是 #2E6BE6 的冷蓝，压在暖纸上像贴上去的：
 *      蓝是"系统默认色"，不是这个 app 选的颜色。现在换成同族的赭（纸上朱笔）。
 *
 * 2026-10-08 从纯 #000/#fff 改为暖调近黑与近白：
 * 纯黑压纯白是最刺眼的组合（前端设计通则的明确禁止项），
 * 暖调让长时间盯屏幕舒服得多，视觉层级不变。
 * 对比度全部实测 ≥ 4.5:1（正文）——改色时别凭感觉，要算。
 *
 * ⚠️ 色值与 src/global.css 里的 html/body 底色**成对维护**，改一边要改另一边。
 */
export const Colors = {
  light: {
    /** 墨：近黑但偏暖，不是 #000 */
    text: '#1A1713',
    /** 纸 */
    background: '#FBF8F3',
    /** 块：卡片、输入框这一层 */
    backgroundElement: '#F2ECE2',
    /** 选中/描边：行按下、chip 底 */
    backgroundSelected: '#E4DBCB',
    textSecondary: '#6E6659',
    /** 链接/可点 tint（赭）：在纸上 ≥5:1 */
    tint: '#A44F26',
  },
  dark: {
    text: '#F3EFE7',
    background: '#121110',
    backgroundElement: '#1F1D18',
    backgroundSelected: '#2D2A24',
    textSecondary: '#B4AC9E',
    tint: '#E2A578',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
