import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AI_CAPABILITIES } from '@/capabilities/types';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { exportBackup } from '@/data/backup/export';
import { restoreFromPicker, type ImportMode } from '@/data/backup/import';
import { SCHEMA_VERSION } from '@/data/db/schema';
import { getReminderSupport, sendTestReminder, syncDailyReminder, type ReminderSupport } from '@/entry/notifications';
import {
  disableNotifyEntry,
  disableOverlay,
  enableNotifyEntry,
  enableOverlay,
  getNotifyEntrySupport,
  getOverlaySupport,
  type NotifyEntrySupport,
  type OverlaySupport,
} from '@/entry/overlay';
import { FOCUS_MINUTE_PRESETS } from '@/domain/focus';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { computeWidgetSnapshot } from '@/widget/snapshot';
import { widgetPreview, type WidgetName } from '@/widget/widgets';

/**
 * 设置页。
 *
 * 它是"默认极简，按需展开"这条原则最直观的地方：
 * 用户不进这里，看到的就是一个干净的记录器；进来之后，深度功能一层层展开。
 * 所以高级功能、AI 能力、接口配置全都藏在同一道开关后面。
 */
export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();

  const settings = useSettings();
  const wipeLocalData = useAppStore((state) => state.wipeLocalData);
  const refresh = useAppStore((state) => state.refresh);

  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 提醒能力是"实际能不能用"的问题，不该靠猜。进来就探一次，并可一键试发。
  const [reminder, setReminder] = useState<ReminderSupport | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getReminderSupport().then((support) => {
      if (alive) setReminder(support);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 悬浮窗同理，而且它的状态还可能被"系统设置"从外面改掉 ——
  // 所以从授权页回来（AppState 变 active）必须重新探一次，不能只信本地记的开关。
  const [overlay, setOverlay] = useState<OverlaySupport | null>(null);
  /** 刚才是去授权页了：回来就接着把气泡开起来，不让用户再点一次 */
  const resumeOverlayRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void getOverlaySupport().then((support) => {
      if (alive) setOverlay(support);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (resumeOverlayRef.current) {
        resumeOverlayRef.current = false;
        void enableOverlay().then(setOverlay);
        return;
      }
      void getOverlaySupport().then(setOverlay);
    });
    return () => subscription.remove();
  }, []);

  const handleToggleOverlay = async (value: boolean) => {
    // 先记下意愿：这样即使这次没开成（比如授权页退出来了），下次启动也还会再试
    settings.setOverlayEnabled(value);
    if (!value) {
      setOverlay(await disableOverlay());
      return;
    }
    const support = overlay ?? (await getOverlaySupport());
    if (support.status === 'unavailable') return;
    if (support.status === 'need-permission') resumeOverlayRef.current = true;
    setOverlay(await enableOverlay());
  };

  // 通知栏入口：它的授权门是通知权限（不是悬浮窗那个），开启时会自己弹授权框
  const [notifyEntry, setNotifyEntry] = useState<NotifyEntrySupport | null>(null);

  useEffect(() => {
    let alive = true;
    void getNotifyEntrySupport().then((support) => {
      if (alive) setNotifyEntry(support);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleToggleNotifyEntry = async (value: boolean) => {
    settings.setNotifyEntryEnabled(value);
    setNotifyEntry(await (value ? enableNotifyEntry() : disableNotifyEntry()));
  };

  // 每日提醒：开关一拨就全撤重排（expo 的 daily 触发器系统管着，
  // 这里只负责"开关状态 = 排没排"）。失败时开关回弹，不给假状态
  const handleToggleDailyReminder = async (value: boolean) => {
    const ok = await syncDailyReminder(value);
    if (ok || !value) settings.setDailyReminderEnabled(value);
  };

  // 小组件实时预览：与桌面同一份组件、同一份快照数据（widget/widgetPreview）
  const [previewName, setPreviewName] = useState<WidgetName>('Today');
  const [previewSnap] = useState(() => computeWidgetSnapshot());

  const handleTestReminder = async () => {
    setTestResult(null);
    const ok = await sendTestReminder(5);
    setTestResult(
      ok
        ? '已排一条 5 秒后的提醒。等 5 秒：弹出来了 = 提醒链路正常；没弹 = 去手机「系统设置 → 应用 → Expo Go → 通知」打开权限，回来再试一次。'
        : '没排上 —— 这台设备当前环境下提醒用不了。',
    );
    setReminder(await getReminderSupport());
  };

  const handleExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const result = await exportBackup();
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
      setMessage(
        `已导出 ${result.fileName}，共 ${total} 条记录。${
          result.shared ? '你可以把它存到网盘或发给自己。' : '文件已写入应用文档目录。'
        }`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 从备份恢复 —— **两种模式在同一个确认框里问，不给第二个入口**（2026-10-12）。
   *
   * `merge`（合并导入）此前只有实现、没有界面入口，等于没有。
   * 补的时候没有加一个「合并导入」的按钮：那会让"导入"这件事在设置里占两行，
   * 而用户此刻想的是同一件事 —— "把这份备份弄进来"。
   * 模式是同一个问题的另一面，就该在同一个框里问完，别让他先点入口再点模式。
   *
   * 为什么非问不可：这两条路互相推不出来，猜错要丢数据 ——
   * - **覆盖**：清空现在全部数据，整库换成这份备份（换手机、回到某天用这个）；
   * - **合并**：现在的东西全留着，同 id 的用备份内容覆盖、新 id 追加（两份数据并起来）。
   *
   * ⚠️ 按钮顺序踩过 Android 的坑：RN 在 Android 上按数组顺序映射成
   * 中性 / 否定 / 肯定三个按钮（`buttons[0]` 最左、`buttons[2]` 最右且高亮），
   * 所以"取消"必须排第一而不是最后 —— 排在最后它会变成被高亮的那个。
   */
  const handleImport = () => {
    Alert.alert(
      '从备份恢复',
      '覆盖导入：清空现在的全部数据，整库换成这份备份。\n' +
        '合并导入：现在的东西留着，同一个 id 的用备份覆盖，新 id 追加进来。\n' +
        '两者都不能撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '合并导入', onPress: () => void runImport('merge') },
        { text: '覆盖导入', style: 'destructive', onPress: () => void runImport('replace') },
      ],
    );
  };

  const runImport = async (mode: ImportMode) => {
    setBusy('import');
    setMessage(null);
    try {
      const summary = await restoreFromPicker(mode);
      if (!summary) {
        setMessage('已取消');
      } else {
        const total = Object.values(summary.imported).reduce((sum, n) => sum + n, 0);
        await refresh();
        // 库换代了：旧任务的已排通知还挂着、新任务的一条没排，全撤重排。
        // 合并同样要重排 —— 覆盖进来的那条任务的提醒跟库里那条是一样的。
        await useAppStore.getState().resyncReminders();
        setMessage(
          summary.mode === 'merge'
            ? `已合并 ${total} 条记录（同 id 的用备份内容覆盖了）`
            : `导入完成，共恢复 ${total} 条记录`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(null);
    }
  };

  const handleWipe = () => {
    Alert.alert('清空本地数据', '所有任务、想法和专注记录都会被删除，且无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认清空',
        style: 'destructive',
        onPress: async () => {
          // 撤通知这件事收在 store 的 wipeLocalData 里（"清空数据"的语义
          // 本来就包含"别再有旧提醒冒出来"），页面不再重复做
          await wipeLocalData();
          setMessage('本地数据已清空');
        },
      },
    ]);
  };

  return (
    <Screen
      title="设置"
      subtitle="默认都很简单，需要时才展开"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {message ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {message}
          </ThemedText>
        </Card>
      ) : null}

      {/* ---------------- 基础 ---------------- */}
      <Card title="基础">
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            默认专注时长（分钟）
          </ThemedText>
          <View style={styles.chips}>
            {FOCUS_MINUTE_PRESETS.map((minutes) => {
              const active = settings.defaultFocusMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  onPress={() => settings.setDefaultFocusMinutes(minutes)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? theme.text : theme.background,
                      borderColor: active ? theme.text : theme.backgroundSelected,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: active ? theme.background : theme.text }}>
                    {minutes}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Row
          title="触感反馈"
          hint="完成、结束专注时给一点轻微的震动"
          right={
            <Switch
              value={settings.hapticsEnabled}
              onValueChange={settings.setHapticsEnabled}
            />
          }
        />

        {/*
          课表的开关放在"基础"里而不是"高级功能"后面：它不高级，只是
          "你有没有课"这个事实的开关。关掉之后日历里既没有「课」那一栏，
          日/周视图也不再画"这段时间有课"。
        */}
        <Row
          title="课表"
          hint="关掉后日历不再显示「课」，日/周视图也不再标出上课时段"
          right={
            <Switch
              value={settings.timetableEnabled}
              onValueChange={settings.setTimetableEnabled}
            />
          }
        />

        {/*
          简约模式：关掉界面上所有"替自己解释"的句子 —— 页面副标题、
          卡片上那行说明小字、日历底部的形状图例、想法页的开通提示。
          它摆在基础区而不是"高级功能"后面：它不是进阶能力，反而是**少看一点**。
        */}
        <Row
          title="简约模式"
          hint="只留内容：不显示副标题、说明小字和图例"
          right={<Switch value={settings.simpleMode} onValueChange={settings.setSimpleMode} />}
        />
      </Card>

      {/* ---------------- 提醒 ---------------- */}
      <Card
        title="提醒"
        hint="定了时间的任务、上课和考试都会提醒">
        <Row
          title="提醒状态"
          hint={reminder ? reminder.message : '正在检测…'}
          right={
            <ThemedText type="smallBold">
              {reminder ? (reminder.moduleAvailable ? (reminder.granted ? '就绪' : '待授权') : '不可用') : '…'}
            </ThemedText>
          }
        />

        <Pressable
          onPress={handleTestReminder}
          style={({ pressed }) => [
            styles.actionRow,
            { borderColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Ionicons name="notifications-outline" size={18} color={theme.text} />
          <ThemedText type="smallBold">试发一条提醒（5 秒后）</ThemedText>
        </Pressable>

        {testResult ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            {testResult}
          </ThemedText>
        ) : null}

        {/*
          每日提醒：内容是静态的（"看看今天的安排"），固定每天 8:00 ——
          动态摘要（"今天有 3 件事"）要原生 receiver 现算，后补。
        */}
        <Row
          title="每日提醒"
          hint="每天 8:00 提一句，点开看看今天的安排"
          right={
            <Switch
              value={settings.dailyReminderEnabled}
              onValueChange={handleToggleDailyReminder}
            />
          }
        />

        {reminder?.inExpoGo ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            当前跑在 Expo Go 里；试发能弹出来就说明提醒是好的。
          </ThemedText>
        ) : null}
      </Card>

      {/* ---------------- 快速入口（只有 Android 独立版有） ---------------- */}
      {Platform.OS === 'android' ? (
        <Card title="快速入口" hint="两个都在试，留下顺手的那个">
          <Row
            title="通知栏"
            hint={notifyEntry ? notifyEntry.message : '正在检测…'}
            right={
              <Switch
                value={notifyEntry?.showing ?? false}
                disabled={notifyEntry?.status === 'unavailable'}
                onValueChange={handleToggleNotifyEntry}
              />
            }
          />
          <Row
            title="悬浮球"
            hint={overlay ? overlay.message : '正在检测…'}
            right={
              <Switch
                value={overlay?.showing ?? false}
                disabled={overlay?.status === 'unavailable'}
                onValueChange={handleToggleOverlay}
              />
            }
          />
        </Card>
      ) : null}

      {/* ---------------- 小组件（预览与桌面同一份代码） ---------------- */}
      <Card title="小组件" hint="长按桌面空白处 → 小组件，拖出去就能用">
        <View style={styles.chips}>
          {WIDGET_PREVIEW_TABS.map((tab) => {
            const active = previewName === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setPreviewName(tab.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.text : theme.background,
                    borderColor: active ? theme.text : theme.backgroundSelected,
                  },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: active ? theme.background : theme.text }}>
                  {tab.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.previewBox} pointerEvents="none">
          {widgetPreview(previewName, previewSnap)}
        </View>
      </Card>

      {/* ---------------- 高级功能（默认关闭） ---------------- */}
      <Card
        title="高级功能"
        hint="默认关闭，不影响日历和清单">
        <Row
          title="启用高级功能"
          hint="开启后才会看到 AI 能力等进阶选项"
          right={
            <Switch
              value={settings.advancedEnabled}
              onValueChange={settings.setAdvancedEnabled}
            />
          }
        />

        {settings.advancedEnabled ? (
          <>
            <Row
              title="AI 能力"
              right={<Switch value={settings.aiEnabled} onValueChange={settings.setAiEnabled} />}
            />

            {settings.aiEnabled ? (
              <>
                {AI_CAPABILITIES.map((capability) => (
                  <Row
                    key={capability.id}
                    title={capability.name}
                    hint={capability.description}
                    right={
                      <Switch
                        value={settings.capabilities[capability.id]}
                        onValueChange={(value) => settings.toggleCapability(capability.id, value)}
                      />
                    }
                  />
                ))}

                <View style={styles.block}>
                  <ThemedText type="small" themeColor="textSecondary">
                    接口地址
                  </ThemedText>
                  <TextInput
                    value={settings.aiConfig.endpoint}
                    onChangeText={(value) => settings.setAiConfig({ endpoint: value })}
                    placeholder="https://your-endpoint.example.com/v1/run"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    style={[
                      styles.input,
                      {
                        color: theme.text,
                        backgroundColor: theme.background,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    调用前会自动脱敏：手机号、邮箱、身份证、银行卡会被遮蔽后再发送。
                  </ThemedText>
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* ---------------- 数据 ---------------- */}
      <Card
        title="数据"
        hint="纯本地存储，只有你主动导出，数据才会离开这台设备">
        <Pressable
          onPress={handleExport}
          disabled={busy !== null}
          style={({ pressed }) => [
            styles.actionRow,
            { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
          ]}>
          <Ionicons name="download-outline" size={18} color={theme.text} />
          <ThemedText type="smallBold">
            {busy === 'export' ? '正在导出…' : '导出备份（JSON）'}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={handleImport}
          disabled={busy !== null}
          style={({ pressed }) => [
            styles.actionRow,
            { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
          ]}>
          <Ionicons name="cloud-upload-outline" size={18} color={theme.text} />
          <ThemedText type="smallBold">
            {busy === 'import' ? '正在导入…' : '从备份恢复'}
          </ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          数据表已预留 updated_at / deleted_at / remote_id / sync_state 四列。
          将来升级成"本地优先 + 云同步"时不需要改结构，也不会丢历史数据。
        </ThemedText>
      </Card>

      {/* ---------------- 开发 ---------------- */}
      {__DEV__ ? (
        <Card title="开发">
          <Pressable
            onPress={handleWipe}
            style={({ pressed }) => [
              styles.actionRow,
              { borderColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons name="trash-outline" size={18} color={theme.text} />
            <ThemedText type="smallBold">清空本地数据</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            仅开发版可见。用于反复验证首次启动、空状态等场景。
          </ThemedText>
        </Card>
      ) : null}

      {/* ---------------- 关于 ---------------- */}
      <Card title="关于">
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          本地库版本 v{SCHEMA_VERSION} · {Platform.OS}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          架构分三层：入口层（记录 / 悬浮球）、本体层（待办 · 清单 · 日历 ·
          想法库 · 项目目标）、能力层（AI，可开关）。
        </ThemedText>
      </Card>
    </Screen>
  );
}

function Row({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** 预览切换的页签。键与原生注册的 widget 名一一对应（app.json plugins） */
const WIDGET_PREVIEW_TABS: readonly { key: WidgetName; label: string }[] = [
  { key: 'Today', label: '今天' },
  { key: 'NextClass', label: '下一节课' },
  { key: 'Week', label: '这一周' },
  { key: 'Month', label: '月历' },
  { key: 'Habit', label: '习惯' },
];

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowHint: { fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewBox: { width: '100%', overflow: 'hidden' },
  footnote: { fontSize: 12, lineHeight: 18, opacity: 0.8 },
});
