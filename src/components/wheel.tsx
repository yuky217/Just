import { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 通用滚动吸附滚轮（从 time-wheel 抽出来的纯 UI 原子）。
 *
 * 它是"一列可滚动、吸附到整格、能点选"的控件，不关心列里装的是小时还是月份。
 * 见 time-wheel.tsx 文件头那一大段"滚轮修过的坑"——所有手势/吸附的坑都在这层，
 * 抽出来后两种用途共用同一套行为。
 *
 * 用法：
 *   <Wheel values={[1,2,3]} index={selectedIndex} onIndexChange={setSelected}
 *          format={(v)=>String(v)} accessibilityLabel="月份" />
 */

export const WHEEL_ITEM_HEIGHT = 36;
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * VISIBLE_ROWS;
const PAD = (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2;

/**
 * 按住轮子后多久自动解锁外层滚动（详见 time-wheel 文件头第 0/1 条）。
 */
const SCROLL_LOCK_MS = 700;

export interface WheelProps<T> {
  values: readonly T[];
  /** 当前选中项在 values 里的下标 */
  index: number;
  onIndexChange: (value: T) => void;
  format: (value: T) => string;
  accessibilityLabel: string;
  /** 轮子在滚（含动量）—— 用来把外层滚动的锁续期 */
  onActivity?: () => void;
}

export function Wheel<T>({
  values,
  index,
  onIndexChange,
  format,
  accessibilityLabel,
  onActivity,
}: WheelProps<T>) {
  const theme = useTheme();
  const ref = useRef<ScrollView>(null);
  /** 我们自己滚出来的下标 —— 用来区分"外部改了值"和"用户滚轮子" */
  const reported = useRef(index);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 首次挂载要定位到当前值，但不能带动画（别让用户看见它从 00 滚过去） */
  const firstRun = useRef(true);

  const scrollToIndex = useCallback((value: number, animated: boolean) => {
    ref.current?.scrollTo({ y: value * WHEEL_ITEM_HEIGHT, animated });
  }, []);

  /**
   * 定位：挂载时到当前值；外部改值（点快捷分、切预设）时跟过去。
   * 用户自己滚出来的不重复滚，否则会和惯性打架。
   */
  useEffect(() => {
    const isFirst = firstRun.current;
    firstRun.current = false;
    if (!isFirst && reported.current === index) return;

    reported.current = index;
    scrollToIndex(index, !isFirst);

    if (isFirst) {
      // Android 上挂载当帧布局可能还没完成，这时 scrollTo 会被丢掉 → 下一帧补一次
      const timer = setTimeout(() => scrollToIndex(index, false), 32);
      return () => clearTimeout(timer);
    }
  }, [index, scrollToIndex]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  /**
   * 结算：把"滚到哪儿了"换算成下标。
   *
   * 只挂一个入口（滚动停止 120ms 后结算）：**不挂 `onScrollEndDrag`** ——
   * 那一刻动量还没跑完，拿着半路的位置去对齐会把轮子停在用户没想选的地方
   * （横向的专注选择器踩过同一个坑）。Web 端没有 momentum 事件，
   * 这个 120ms 防抖正好把它一起覆盖了。
   */
  const settleAt = useCallback(
    (offsetY: number) => {
      const raw = Math.round(offsetY / WHEEL_ITEM_HEIGHT);
      const next = values[Math.max(0, Math.min(values.length - 1, raw))];
      if (next === undefined) return;

      if (next === values[index]) {
        // 没滚过半格：吸回原位。容差 1px 是为了不把自己滚出来的 onScroll 再触发一次
        if (Math.abs(offsetY - index * WHEEL_ITEM_HEIGHT) > 1) scrollToIndex(index, true);
        return;
      }
      reported.current = raw;
      onIndexChange(next);
      // 兜一下 Web（那边的吸附不总生效）；原生端本来就已经吸附到位，等于空转
      scrollToIndex(raw, true);
    },
    [index, onIndexChange, scrollToIndex, values],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onActivity?.();
      const offsetY = event.nativeEvent.contentOffset.y;
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => settleAt(offsetY), 120);
    },
    [onActivity, settleAt],
  );

  return (
    <ScrollView
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      showsVerticalScrollIndicator={false}
      // Android：允许在另一个 ScrollView 里自己滚（否则外层会把手势全吃掉）
      nestedScrollEnabled
      snapToInterval={WHEEL_ITEM_HEIGHT}
      decelerationRate="fast"
      scrollEventThrottle={16}
      contentContainerStyle={styles.wheelContent}
      onScroll={handleScroll}
      style={styles.wheel}>
      {values.map((value, i) => {
        const active = i === index;
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={format(value)}
            // 点谁选谁：滚动手势的保底通道（见 time-wheel 文件头第 0 条）。
            // 只在值确实变了时走 onChange，避免点中选行触发多余的父级重渲染。
            onPress={() => {
              if (i === index) return;
              reported.current = i;
              onIndexChange(value);
              scrollToIndex(i, true);
            }}
            style={styles.item}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={[styles.itemText, !active && styles.itemIdle]}>
              {format(value)}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wheel: { height: WHEEL_ITEM_HEIGHT * 5, flexGrow: 0, width: 88 },
  wheelContent: { paddingVertical: PAD },
  item: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 20, lineHeight: 26 },
  itemIdle: { fontSize: 16, opacity: 0.55 },
});
