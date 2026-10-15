import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ChoiceSheet, type ChoiceOption } from '@/components/choice-sheet';
import { EmptyState } from '@/components/empty-state';
import { LunarPicker } from '@/components/lunar-picker';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CalendarKind, Mark } from '@/domain/container';
import { MarkKind } from '@/domain/enums';
import { hasDuplicateTitle, describeMark, sortMarkViews } from '@/domain/marks';
import { SOLAR_TERMS, markCalendarLabel } from '@/domain/lunar';
import type { CreateMarkInput } from '@/domain/factory';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { dayKeyOf, parseDayKey } from '@/utils/datetime';

/**
 * 纪念日（主文档 5.3 的"标记"）。
 *
 * 它是**独立于任务**的一种东西：不提醒、不排程、不进待办。
 * 倒数日（还剩几天）和正数日（已经多少天）是两种完全不同的情绪 ——
 * 前者是期待，后者是坚持，所以列表里正数日排在后面，不去抢"即将发生"的位置。
 *
 * 一个细节：开了"每年重复"的倒数日会自动滚到下一次周年，
 * 所以生日、结婚纪念这类日子只需要录一次。
 *
 * 历法（第一批）：公历 / 农历 / 节气 三选一。
 * - 公历：沿用原来的 MonthPicker；
 * - 农历：月份滚轮 + 闰月开关 + 日滚轮 + 文本解析（见 LunarPicker）；
 * - 节气：从 24 节气里挑一个（ChoiceSheet）。
 * 农历 / 节气也照样存一个公历锚点（第一批不做日历上按历法显示，详见 working memory）。
 */
const CALENDAR_CHIPS: { key: CalendarKind; label: string }[] = [
  { key: 'solar', label: '公历' },
  { key: 'lunar', label: '农历' },
  { key: 'term', label: '节气' },
];

const TERM_OPTIONS: readonly ChoiceOption[] = SOLAR_TERMS.map((t) => ({ key: t, label: t }));

export default function MarksScreen() {
  const theme = useTheme();
  const router = useRouter();

  const marks = useAppStore((state) => state.marks);
  const createMark = useAppStore((state) => state.createMark);
  const updateMark = useAppStore((state) => state.updateMark);
  const removeMark = useAppStore((state) => state.removeMark);

  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<MarkKind>(MarkKind.Countdown);
  const [draftCalendar, setDraftCalendar] = useState<CalendarKind>('solar');
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [draftDateEditing, setDraftDateEditing] = useState(false);
  const [draftLunarMd, setDraftLunarMd] = useState<string | null>(null);
  const [draftLunarEditing, setDraftLunarEditing] = useState(false);
  const [draftTerm, setDraftTerm] = useState<string | null>(null);
  const [termSheetVisible, setTermSheetVisible] = useState(false);
  const [draftYearly, setDraftYearly] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);

  const views = useMemo(() => sortMarkViews(marks.map((mark) => describeMark(mark))), [marks]);
  const editing = marks.find((mark) => mark.id === editingId) ?? null;

  const resetDraft = () => {
    setDraftTitle('');
    setDraftKind(MarkKind.Countdown);
    setDraftCalendar('solar');
    setDraftDate(null);
    setDraftLunarMd(null);
    setDraftTerm(null);
    setDraftYearly(false);
    setDraftDateEditing(false);
    setDraftLunarEditing(false);
    setTermSheetVisible(false);
  };

  const pickCalendar = (next: CalendarKind) => {
    setDraftCalendar(next);
    // 切到农历 / 节气时给个默认，避免"选完历法却没选具体日子"的死胡同
    if (next === 'lunar' && !draftLunarMd) setDraftLunarMd(`${new Date().getMonth() + 1}-1`);
    if (next === 'term' && !draftTerm) setDraftTerm('清明');
  };

  const doCreate = async (base: CreateMarkInput) => {
    await createMark(base);
    resetDraft();
    setCreating(false);
  };

  const submit = async () => {
    const title = draftTitle.trim();
    if (!title) return;
    const base: CreateMarkInput = { title, kind: draftKind, repeatYearly: draftYearly };

    if (draftCalendar === 'solar') {
      const date = draftDate ?? dayKeyOf(new Date().toISOString());
      if (!date) return;
      base.date = date;
    } else if (draftCalendar === 'lunar') {
      if (!draftLunarMd) return;
      base.calendar = 'lunar';
      base.lunarMd = draftLunarMd;
    } else {
      if (!draftTerm) return;
      base.calendar = 'term';
      base.term = draftTerm;
    }

    // 节气同名冲突：提示用户"已有同名，要不要合并？"
    if (base.calendar === 'term' && hasDuplicateTitle(marks, title)) {
      const existing = marks.find((m) => m.title.trim() === title);
      Alert.alert('已有同名', `已经有一个叫「${title}」的纪念日了。\n要合并成一个，还是再建一个？`, [
        { text: '取消', style: 'cancel' },
        { text: '仍然创建', onPress: () => void doCreate(base) },
        ...(existing
          ? [
              {
                text: '去改那个',
                onPress: () => {
                  setCreating(false);
                  setEditingId(existing.id);
                },
              },
            ]
          : []),
      ]);
      return;
    }

    await doCreate(base);
  };

  const draftLabel = markCalendarLabel(draftCalendar, draftLunarMd, draftTerm, draftDate ?? '');

  return (
    <Screen
      title="纪念日"
      subtitle="不提醒、不催办，只把日子摆在你眼前"
      right={
        <Pressable hitSlop={8} onPress={() => setCreating((value) => !value)}>
          <Ionicons name={creating ? 'close' : 'add'} size={24} color={theme.text} />
        </Pressable>
      }>
      {creating ? (
        <Card title="加一个日子">
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="是什么日子"
            placeholderTextColor={theme.textSecondary}
            autoFocus
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.background,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />

          <View style={styles.chips}>
            <Chip
              label="还剩几天"
              active={draftKind === MarkKind.Countdown}
              theme={theme}
              onPress={() => setDraftKind(MarkKind.Countdown)}
            />
            <Chip
              label="已经多少天"
              active={draftKind === MarkKind.CountUp}
              theme={theme}
              onPress={() => setDraftKind(MarkKind.CountUp)}
            />
          </View>

          <View style={styles.chips}>
            {CALENDAR_CHIPS.map((chip) => (
              <Chip
                key={chip.key}
                label={chip.label}
                active={draftCalendar === chip.key}
                theme={theme}
                onPress={() => pickCalendar(chip.key)}
              />
            ))}
          </View>

          {draftCalendar === 'solar' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDraftDateEditing((value) => !value)}
                style={({ pressed }) => [
                  styles.settingRow,
                  { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                ]}>
                <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="small">{draftDate ? draftDate.replace(/-/g, '/') : '选一天'}</ThemedText>
                <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
              </Pressable>
              {draftDateEditing ? (
                <MonthPicker
                  value={draftDate}
                  onChange={(key) => setDraftDate(key)}
                  onDone={() => setDraftDateEditing(false)}
                />
              ) : null}
            </>
          ) : null}

          {draftCalendar === 'lunar' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDraftLunarEditing((value) => !value)}
                style={({ pressed }) => [
                  styles.settingRow,
                  { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                ]}>
                <Ionicons name="moon-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="small">{draftLabel}</ThemedText>
                <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
              </Pressable>
              {draftLunarEditing ? (
                <LunarPicker value={draftLunarMd} onChange={(md) => setDraftLunarMd(md)} />
              ) : null}
            </>
          ) : null}

          {draftCalendar === 'term' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTermSheetVisible(true)}
                style={({ pressed }) => [
                  styles.settingRow,
                  { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                ]}>
                <Ionicons name="leaf-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="small">{draftLabel || '选一个节气'}</ThemedText>
                <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
              </Pressable>
              <ChoiceSheet
                visible={termSheetVisible}
                title="选节气"
                options={TERM_OPTIONS}
                selectedKey={draftTerm ?? undefined}
                onSelect={(key) => {
                  setDraftTerm(key);
                  setTermSheetVisible(false);
                }}
                onClose={() => setTermSheetVisible(false)}
              />
            </>
          ) : null}

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <ThemedText type="smallBold">每年重复</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                {draftCalendar === 'lunar' || draftCalendar === 'term'
                  ? '农历 / 节气本来每年就有，照常滚到下一次'
                  : '生日、纪念日这类只需要录一次'}
              </ThemedText>
            </View>
            <Switch value={draftYearly} onValueChange={setDraftYearly} />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              记下来
            </ThemedText>
          </Pressable>
        </Card>
      ) : null}

      {views.length ? (
        <View style={styles.list}>
          {views.map((view) => {
            const isEditing = editingId === view.mark.id;
            return (
              <View key={view.mark.id} style={styles.item}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${view.mark.title}，${view.headline}${view.caption}`}
                  onPress={() => {
                    setEditingId(isEditing ? null : view.mark.id);
                    setEditingDate(false);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                  ]}>
                  <View style={styles.dayBlock}>
                    <ThemedText style={styles.headline}>{view.headline}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
                      {view.caption}
                    </ThemedText>
                  </View>
                  <View style={styles.rowBody}>
                    <ThemedText type="smallBold" numberOfLines={2}>
                      {view.mark.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                      {markCalendarLabel(
                        view.mark.calendar,
                        view.mark.lunarMd,
                        view.mark.term,
                        view.mark.date,
                      ).replace(/-/g, '/')}
                      {view.mark.repeatYearly ? ' · 每年' : ''}
                      {view.mark.kind === MarkKind.CountUp ? ' · 正数' : ' · 倒数'}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name={isEditing ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.textSecondary}
                  />
                </Pressable>

                {isEditing && editing ? (
                  <EditCard
                    mark={editing}
                    theme={theme}
                    onUpdate={(patch) => void updateMark(editing.id, patch)}
                    onRemove={async () => {
                      await removeMark(editing.id);
                      setEditingId(null);
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon="heart-outline"
          title="还没有纪念日"
          hint="记一个还剩几天的日子，或者已经坚持了多少天"
        />
      )}

      <Card>
        <View style={styles.tipRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.tipText}>
            纪念日独立于任务：不提醒、不进待办，只是让日子有个地方待着。
            日历页会把它点在那天，并挑几个最近要发生的列出来。
          </ThemedText>
        </View>
      </Card>

      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backRow}>
        <ThemedText type="small" themeColor="textSecondary">
          返回
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

/** 单个纪念日的编辑卡（展开态） */
function EditCard({
  mark,
  theme,
  onUpdate,
  onRemove,
}: {
  mark: Mark;
  theme: ReturnType<typeof useTheme>;
  onUpdate: (patch: Partial<Mark>) => void;
  onRemove: () => void;
}) {
  const [editingDate, setEditingDate] = useState(false);
  const [lunarEditing, setLunarEditing] = useState(false);
  const [termSheetVisible, setTermSheetVisible] = useState(false);

  const calendar = mark.calendar ?? 'solar';
  const label = markCalendarLabel(mark.calendar, mark.lunarMd, mark.term, mark.date);

  return (
    <Card>
      <TextInput
        defaultValue={mark.title}
        onEndEditing={(e) => {
          const next = e.nativeEvent.text.trim();
          if (next && next !== mark.title) onUpdate({ title: next });
        }}
        placeholder="是什么日子"
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.background,
            borderColor: theme.backgroundSelected,
          },
        ]}
      />

      <View style={styles.chips}>
        <Chip
          label="还剩几天"
          active={mark.kind === MarkKind.Countdown}
          theme={theme}
          onPress={() => onUpdate({ kind: MarkKind.Countdown })}
        />
        <Chip
          label="已经多少天"
          active={mark.kind === MarkKind.CountUp}
          theme={theme}
          onPress={() => onUpdate({ kind: MarkKind.CountUp })}
        />
      </View>

      <View style={styles.chips}>
        {CALENDAR_CHIPS.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            active={calendar === chip.key}
            theme={theme}
            onPress={() => onUpdate({ calendar: chip.key })}
          />
        ))}
      </View>

      {calendar === 'solar' ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditingDate((value) => !value)}
            style={({ pressed }) => [
              styles.settingRow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small">{mark.date.replace(/-/g, '/')}</ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </Pressable>
          {editingDate ? (
            <MonthPicker
              value={mark.date}
              onChange={(key) => {
                if (key) onUpdate({ date: key });
              }}
              onDone={() => setEditingDate(false)}
            />
          ) : null}
        </>
      ) : null}

      {calendar === 'lunar' ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setLunarEditing((value) => !value)}
            style={({ pressed }) => [
              styles.settingRow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Ionicons name="moon-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small">{label}</ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </Pressable>
          {lunarEditing ? (
            <LunarPicker
              value={mark.lunarMd ?? null}
              onChange={(md) => onUpdate({ lunarMd: md, calendar: 'lunar' })}
            />
          ) : null}
        </>
      ) : null}

      {calendar === 'term' ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTermSheetVisible(true)}
            style={({ pressed }) => [
              styles.settingRow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Ionicons name="leaf-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small">{label || '选一个节气'}</ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </Pressable>
          <ChoiceSheet
            visible={termSheetVisible}
            title="选节气"
            options={TERM_OPTIONS}
            selectedKey={mark.term ?? undefined}
            onSelect={(key) => {
              onUpdate({ term: key, calendar: 'term' });
              setTermSheetVisible(false);
            }}
            onClose={() => setTermSheetVisible(false)}
          />
        </>
      ) : null}

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <ThemedText type="smallBold">每年重复</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            倒数日会自动滚到下一次周年
          </ThemedText>
        </View>
        <Switch
          value={mark.repeatYearly}
          onValueChange={(value) => onUpdate({ repeatYearly: value })}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        style={({ pressed }) => [
          styles.danger,
          { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
        ]}>
        <ThemedText type="small" themeColor="textSecondary">
          删除这个纪念日
        </ThemedText>
      </Pressable>
    </Card>
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.background,
          borderColor: active ? theme.text : theme.backgroundSelected,
        },
      ]}>
      <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  item: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  dayBlock: { alignItems: 'center', minWidth: 56 },
  headline: { fontSize: 22, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 10, lineHeight: 13 },
  rowBody: { flex: 1, gap: Spacing.half },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  switchText: { flex: 1, gap: Spacing.half },
  footnote: { fontSize: 12, lineHeight: 16, opacity: 0.8 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  danger: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  tipText: { flex: 1, lineHeight: 18 },
  backRow: { alignItems: 'center', paddingVertical: Spacing.two },
});
