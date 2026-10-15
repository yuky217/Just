import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * 翻页钟（split-flap）。
 *
 * 一片数字卡怎么"翻"：上片绕**中缝**往下倒（0° → -90°），倒过中缝之后
 * 由下片接手，从 90° 落回 0°。所以一张卡同时有四个面：
 *   静态上半 = 新值 · 静态下半 = 旧值 · 翻的上片 = 旧值 · 翻的下片 = 新值
 * 不翻的时候只画静态那两片 —— 一整分钟只有一次动画，整页是静的。
 *
 * 两个容易写错的地方：
 *   · **旋转轴不在中心**。上片要绕自己的下边转、下片要绕自己的上边转，
 *     所以得"平移到轴 → 转 → 平移回去"（偏移是片高的一半，不是卡高的一半）。
 *   · **秒不翻**。每秒翻一次就不是"安静"了，那是催人。所以只翻到分钟。
 */

const CARD_W = 60;
const CARD_H = 88;
const SEP_W = 12;
const GAP = 5;
const FONT = 60;
const RADIUS = 8;
/** 四张卡 + 两个冒号 + 五个缝，用来算能不能塞进这一屏 */
const BASE_WIDTH = CARD_W * 4 + SEP_W * 2 + GAP * 5;
/** 翻一次的时长。慢一点才是"翻页"，快了就成了闪烁 */
const FLIP_MS = 480;
const PERSPECTIVE = 900;
/**
 * 放大上限。横屏时宽不再是瓶颈，钟会长到很高，得有个头 ——
 * 2.4 倍正好把钟块压在 `MaxContentWidth` 减去两边内边距之内（296 × 2.4 = 710 < 752），
 * 不会顶出内容列。
 */
const MAX_SCALE = 2.4;
/** 日期行 + 与钟的间距，算"钟能长多高"时先把它扣掉 */
const BELOW_CLOCK = 40;

interface CardProps {
  char: string;
  width: number;
  height: number;
  fontSize: number;
  radius: number;
  background: string;
  color: string;
  /** 中缝的颜色 = 页面的纸色，卡看着才像被切开了 */
  seam: string;
}

function FlipCard({
  char,
  width,
  height,
  fontSize,
  radius,
  background,
  color,
  seam,
}: CardProps) {
  /** 屏幕上正显示着的那个字。用它跟新值比，才知道要不要翻 */
  const shown = useRef(char);
  const [pair, setPair] = useState({ from: char, to: char });
  const [flipping, setFlipping] = useState(false);
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (char === shown.current) return;
    const from = shown.current;
    shown.current = char;
    setPair({ from, to: char });
    setFlipping(true);
    anim.setValue(0);
    // 线性：翻页是机械动作，加速再减速那种"弹性"不属于这里
    Animated.timing(anim, {
      toValue: 1,
      duration: FLIP_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => setFlipping(false));
  }, [char, anim]);

  /** 片高的一半 —— 上片绕下边、下片绕上边，都是这个数 */
  const pivot = height / 4;
  const topDeg = anim.interpolate({
    inputRange: [0, 0.5],
    outputRange: ['0deg', '-90deg'],
    extrapolate: 'clamp',
  });
  const bottomDeg = anim.interpolate({
    inputRange: [0.5, 1],
    outputRange: ['90deg', '0deg'],
    extrapolate: 'clamp',
  });

  /** 半片：整张字卡裁一半出来（下半靠把字往上顶半格） */
  const half = (value: string, part: 'top' | 'bottom') => (
    <View
      style={[
        styles.half,
        { height: height / 2, backgroundColor: background },
        part === 'top'
          ? {
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
            }
          : {
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
            },
      ]}>
      <Text
        style={[
          styles.digit,
          {
            color,
            fontSize,
            height,
            lineHeight: height,
            top: part === 'bottom' ? -height / 2 : 0,
          },
        ]}>
        {value}
      </Text>
    </View>
  );

  return (
    <View style={[styles.card, { width, height, borderRadius: radius, backgroundColor: background }]}>
      {half(pair.to, 'top')}
      {half(pair.from, 'bottom')}

      {/* 中缝：纸色的细线，卡看起来才像两片叠起来的 */}
      <View
        pointerEvents="none"
        style={[styles.seam, { top: height / 2 - 1, backgroundColor: seam }]}
      />

      {flipping ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flap,
              { top: 0, width, height: height / 2 },
              {
                transform: [
                  { perspective: PERSPECTIVE },
                  { translateY: pivot },
                  { rotateX: topDeg },
                  { translateY: -pivot },
                ],
              },
            ]}>
            {half(pair.from, 'top')}
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flap,
              { top: height / 2, width, height: height / 2 },
              {
                transform: [
                  { perspective: PERSPECTIVE },
                  { translateY: -pivot },
                  { rotateX: bottomDeg },
                  { translateY: pivot },
                ],
              },
            ]}>
            {half(pair.to, 'bottom')}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

/** 冒号：两个点，不闪 —— 闪是"在走"的提示，而这里不需要提醒人时间在走 */
function Separator({ height, color }: { height: number; color: string }) {
  const dot = Math.max(4, Math.round(height * 0.07));
  return (
    <View style={[styles.separator, { width: SEP_W, height }]}>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
    </View>
  );
}

/**
 * 翻页钟。`value` 是 `HH:mm`，冒号不参与翻。
 *
 * 尺寸按屏缩放：**宽和高都要比**。
 *   · 只按宽算的话，横屏（944 × 439）那支会算出 3 倍多然后被上限砍掉 ——
 *     钟是变大了，可它不知道自己还有多少高度可以长，很容易顶到边。
 *   · 只按高算的话，竖屏那支会失控（手机再矮也有五百多，能算出 6 倍）。
 * 所以取两个方向的**较小值**，再统一收进 0.8–2.4。
 *
 * 竖屏下按高那支恒不生效（要矮到 250 以下才会插手），所以竖屏观感与改之前完全一致。
 */
export function FlipClock({ value }: { value: string }) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const byWidth = (width - 48) / BASE_WIDTH;
  const byHeight = (height * 0.62 - BELOW_CLOCK) / CARD_H;
  const scale = Math.min(MAX_SCALE, Math.max(0.8, Math.min(byWidth, byHeight)));

  return (
    <View style={[styles.row, { gap: GAP * scale }]}>
      {value.split('').map((char, index) =>
        char === ':' ? (
          <Separator key={index} height={CARD_H * scale} color={theme.textSecondary} />
        ) : (
          <FlipCard
            key={index}
            char={char}
            width={CARD_W * scale}
            height={CARD_H * scale}
            fontSize={FONT * scale}
            radius={RADIUS * scale}
            background={theme.backgroundElement}
            color={theme.text}
            seam={theme.background}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  half: { width: '100%', overflow: 'hidden' },
  digit: {
    width: '100%',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  /** 中缝：用纸色画，于是卡被"切"成上下两片 */
  seam: { position: 'absolute', left: 0, right: 0, height: 2 },
  flap: { position: 'absolute', left: 0, backfaceVisibility: 'hidden' },
  separator: { alignItems: 'center', justifyContent: 'center', gap: 10 },
});
