import { Ionicons } from '@expo/vector-icons';
import { addDays, format } from 'date-fns';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { DateTimeSheet, defaultDraft, type DateTimeDraft } from '@/components/date-time-picker';
import { Spacing } from '@/constants/theme';
import { predictPeriod } from '@/domain/period';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { parseDayKey, toDayKey } from '@/utils/datetime';
import { ThemedText } from './themed-text';

/**
 * 经期首页卡（2026-10-14）。
 *
 * 设计取舍：**默认零操作**。
 * - 刚开启还没记过时，一句话教他"记一次就能预测"，并给一个「记今天」—— 点一下就完，
 *   不用先去某个二级页面。
 * - 记过之后，卡上直接显示「还有 N 天 / 预计 M月d日」；想细调（周期长度、
 *   经期长度、提醒提前量、补记过去的来潮）才点开下面的箭头进 `PeriodSheet`。
 *
 * 关掉功能（features.period）时整张卡不渲染 —— 这是「关掉就要关干净」在首页的落点。
 */
export function PeriodCard() {
  const theme = useTheme();
  const periodOn = useSettings((state) => state.features.period ?? true);
  const cycleLength = useSettings((state) => state.periodCycleLength);
  const periodLength = useSettings((state) => state.periodLength);

  const logs = useAppStore((state) => state.periodLogs);
  const logPeriod = useAppStore((state) => state.logPeriod);

  const [sheetOpen, setSheetOpen] = useState(false);

  if (!periodOn) return null;

  const forecast = predictPeriod(logs, { cycleLength, periodLength });

  let status: string;
  if (!forecast.hasData) {
    status = '记一次来潮，就能预测下次';
  } else if (forecast.phase === 'period') {
    status = `经期进行中 · 第 ${forecast.dayOfPeriod} 天`;
  } else {
    status = `还有 ${forecast.daysUntilNext} 天 · 预计 ${format(forecast.nextStart!, 'M月d日')}`;
  }

  const logToday = () => void logPeriod(toDayKey(new Date()), periodLength);

  return (
    <>
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="经期设置"
          onPress={() => setSheetOpen(true)}
          style={styles.headRow}>
          <Ionicons name="water-outline" size={18} color={theme.text} />
          <View style={styles.headText}>
            <ThemedText type="smallBold">经期</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {status}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="记今天来潮"
          onPress={logToday}
          style={({ pressed }) => [
            styles.logRow,
            { opacity: pressed ? 0.6 : 1 },
          ]}>
          <Ionicons name="add" size={16} color={theme.tint} />
          <ThemedText type="small" style={{ color: theme.tint }}>
            记今天来潮
          </ThemedText>
        </Pressable>
      </Card>

      <PeriodSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

/** 设置 / 补记的弹层：周期·经期·提醒三项数值，加补记过去的来潮与历史删除 */
function PeriodSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const cycleLength = useSettings((state) => state.periodCycleLength);
  const periodLength = useSettings((state) => state.periodLength);
  const reminderDays = useSettings((state) => state.periodReminderDays);
  const setCycle = useSettings((state) => state.setPeriodCycleLength);
  const setLen = useSettings((state) => state.setPeriodLength);
  const setRem = useSettings((state) => state.setPeriodReminderDays);

  const logs = useAppStore((state) => state.periodLogs);
  const logPeriod = useAppStore((state) => state.logPeriod);
  const removePeriodLog = useAppStore((state) => state.removePeriodLog);

  const [pickerOpen, setPickerOpen] = useState(false);
  // 默认指向"约一个周期前"，让补记上次来潮时不用从今天一路滚回去
  const [draft, setDraft] = useState<DateTimeDraft>(
    defaultDraft(addDays(new Date(), -28)),
  );

  const confirmDate = (value: DateTimeDraft) => {
    setPickerOpen(false);
    void logPeriod(toDayKey(value.date), periodLength);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">经期设置</ThemedText>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <Stepper
            label="周期长度"
            hint="两次来潮间隔天数"
            value={cycleLength}
            min={15}
            max={60}
            unit=" 天"
            onChange={setCycle}
          />
          <Stepper
            label="经期长度"
            hint="每次持续几天"
            value={periodLength}
            min={1}
            max={14}
            unit=" 天"
            onChange={setLen}
          />
          <Stepper
            label="提前提醒"
            hint="来潮前几天发一条提醒"
            value={reminderDays}
            min={0}
            max={10}
            unit=" 天"
            onChange={setRem}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="补记一次来潮"
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [
              styles.dateRow,
              { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
            ]}>
            <Ionicons name="calendar-outline" size={16} color={theme.text} />
            <ThemedText type="small">补记一次来潮（选日期）</ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>

          {logs.length ? (
            <View style={styles.history}>
              <ThemedText type="small" themeColor="textSecondary">
                已记 {logs.length} 次
              </ThemedText>
              {logs.map((log) => {
                const d = parseDayKey(log.startDayKey);
                return (
                  <View key={log.id} style={styles.historyRow}>
                    <ThemedText type="small">
                      {d ? format(d, 'yyyy年M月d日') : log.startDayKey} · 持续 {log.length} 天
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="删除这条记录"
                      onPress={() => void removePeriodLog(log.id)}>
                      <Ionicons name="trash-outline" size={16} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Pressable>

      <DateTimeSheet
        visible={pickerOpen}
        value={draft}
        onChange={setDraft}
        onCancel={() => setPickerOpen(false)}
        onConfirm={confirmDate}
        title="来潮是哪天"
      />
    </Modal>
  );
}

/** 数值调节行（− 数值 +），这一处专用，不进通用组件库 */
function Stepper({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (next: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      <View style={styles.stepperCtrl}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`减少${label}`}
          disabled={value <= min}
          onPress={() => onChange(value - 1)}
          style={({ pressed }) => [
            styles.stepBtn,
            { borderColor: theme.backgroundSelected, opacity: value <= min || pressed ? 0.4 : 1 },
          ]}>
          <ThemedText type="smallBold">−</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.stepValue}>
          {value}
          {unit}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`增加${label}`}
          disabled={value >= max}
          onPress={() => onChange(value + 1)}
          style={({ pressed }) => [
            styles.stepBtn,
            { borderColor: theme.backgroundSelected, opacity: value >= max || pressed ? 0.4 : 1 },
          ]}>
          <ThemedText type="smallBold">+</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headText: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.two },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperText: { gap: 2, flex: 1 },
  stepperCtrl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 44, textAlign: 'center' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  history: { gap: Spacing.two, marginTop: Spacing.one },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
