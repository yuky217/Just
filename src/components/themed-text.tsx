import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'caption'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        {
          color: theme[themeColor ?? (type === 'linkPrimary' ? 'tint' : 'text')],
        },
        styles.base,
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'caption' && styles.caption,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  /**
   * 等宽数字（tabular-nums）全局生效：日程 app 里日期、时刻、计数无处不在，
   * 比例数字会让"08"和"10"宽度不同，列表刷新时右侧的时间列会轻轻抖动。
   * 只影响数字与表格标点，中文完全不受影响。
   * fontFamily 显式接上 Fonts.sans：web 端指向 --font-display（Spline Sans），
   * 原生端是系统字体，等于没变。之前声明了字体却没人引用，一直回退默认。
   */
  base: { fontVariant: ['tabular-nums'], fontFamily: Fonts.sans },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  /**
   * 最小的那一档：卡片 hint、格子的"为什么是它"、时间戳。
   * 之前这些地方各自写 fontSize: 12 / 10 —— 同一个角色有五六种写法，
   * 收成一档，改一次全站跟着变。
   */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 25,
    fontWeight: 500,
  },
  /**
   * 大字号那一档（页面标题 / 首屏问候）2026-10-13 收紧过一次：
   * 行高从 1.37 压到 1.27、字重 600 → 700、加负字距。
   * 中文在 30px 以上，行高留太多会显得字"浮"在一大片空白里 ——
   * 大字号要的是**密**（字挨紧、块成一坨），不是要周围更空。
   * 负字距只在汉字之间生效得很轻，主要修的是数字和标点之间的缝隙。
   */
  title: {
    fontSize: 46,
    fontWeight: 700,
    lineHeight: 52,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: 700,
    letterSpacing: -0.55,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
