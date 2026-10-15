import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * 专注界面的"小东西"（主文档第六节）。
 *
 * 唯一必须遵守的规则：**只涨不落，不惩罚**。
 * 所以下面的 scale 是累计秒数的单调函数 —— 中途退出、提前结束，
 * 它只会保持原样，绝不会缩回去。动画留到后续版本再加。
 *
 * ⚠️ 2026-10-13：**它自己不带任何文字**。
 * 以前球下面挂着一行"已生长 3 小时 12 分"，而那一行说的是**过去**：
 * 用户站在这儿要决定的是"现在做什么"，不是欣赏自己攒了多少。
 * 首页把球本身当成了开始键，字更不能压在键上 —— 想看的时长数字，
 * 专注页里那颗大计时器上一直都有。
 */
export interface GrowthOrbProps {
  /** 累计生长秒数 */
  seconds: number;
  size?: number;
}

export function GrowthOrb({ seconds, size = 96 }: GrowthOrbProps) {
  const theme = useTheme();

  // 对数增长：前期长得快（有反馈），后期变慢但永不回退
  const level = Math.log10(Math.max(1, seconds / 60) + 1);
  const ratio = Math.min(1, level / 2.2);
  const diameter = size * (0.4 + 0.6 * ratio);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.text,
          opacity: 0.08,
        }}
        pointerEvents="none"
      />
      <View
        style={[
          styles.core,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            backgroundColor: theme.text,
            opacity: 0.35 + 0.5 * ratio,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  core: { position: 'absolute' },
});
