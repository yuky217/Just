import { useState } from 'react';
import { Switch, TextInput, View, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Wheel } from '@/components/wheel';
import {
  dayToChinese,
  formatLunarMd,
  monthToChinese,
  parseLunarMd,
  parseLunarText,
  type LunarMd,
} from '@/domain/lunar';

/**
 * 农历日期选择器：月份滚轮（正月..腊月）+ 闰月开关 + 日滚轮（初一..三十）
 * + 一个文本输入框（"闰八月初五" 这类口语直接解析）。
 *
 * 用滚轮还是打字都行，两者实时互通：滚轮一动就回填文本，文本一输对就驱动滚轮。
 * 不做得更花：农历标记是低频操作，用户多半一年才录一两次生日，简单够用。
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

export interface LunarPickerProps {
  /** 当前值：'8-15' / 'leap2-5'，或 null */
  value: string | null;
  onChange: (lunarMd: string) => void;
}

export function LunarPicker({ value, onChange }: LunarPickerProps) {
  const theme = useTheme();
  const initial = parseLunarMd(value) ?? { leap: false, month: new Date().getMonth() + 1, day: 1 };

  const [leap, setLeap] = useState(initial.leap);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [text, setText] = useState('');

  const commit = (next: LunarMd) => onChange(formatLunarMd(next));

  const onMonth = (m: number) => {
    setMonth(m);
    commit({ leap, month: m, day });
  };
  const onDay = (d: number) => {
    setDay(d);
    commit({ leap, month, day: d });
  };
  const onLeap = (v: boolean) => {
    setLeap(v);
    commit({ leap: v, month, day });
  };
  const onText = (raw: string) => {
    setText(raw);
    const parsed = parseLunarText(raw);
    if (parsed) {
      setLeap(parsed.leap);
      setMonth(parsed.month);
      setDay(parsed.day);
      commit(parsed);
    }
  };

  const monthIndex = Math.max(0, Math.min(11, month - 1));
  const dayIndex = Math.max(0, Math.min(29, day - 1));
  const label = `${leap ? '闰' : ''}${monthToChinese(month)}${dayToChinese(day)}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.leapRow}>
        <ThemedText type="small">闰月</ThemedText>
        <Switch value={leap} onValueChange={onLeap} />
      </View>

      <View style={styles.row}>
        <Wheel
          values={MONTHS}
          index={monthIndex}
          onIndexChange={onMonth}
          format={monthToChinese}
          accessibilityLabel="农历月"
        />
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.unit}>
          月
        </ThemedText>
        <Wheel
          values={DAYS}
          index={dayIndex}
          onIndexChange={onDay}
          format={dayToChinese}
          accessibilityLabel="农历日"
        />
      </View>

      <TextInput
        value={text}
        onChangeText={onText}
        placeholder="或输入：闰八月初五 / 八月十五"
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
        ]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        已选：{label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.two },
  leapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  unit: { fontSize: 18, paddingBottom: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  hint: { fontSize: 12, lineHeight: 16 },
});
