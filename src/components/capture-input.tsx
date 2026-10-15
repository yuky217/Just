import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { isCapabilityReady, understandText } from '@/capabilities/client';
import { AiCapability } from '@/capabilities/types';
import { ChoiceSheet, type ChoiceOption } from '@/components/choice-sheet';
import {
  DateTimeSheet,
  describeDraft,
  draftFromTask,
  draftToTime,
  defaultDraft,
  type DateTimeDraft,
  type DateTimePreset,
} from '@/components/date-time-picker';
import { describeSpeechError, isSpeechAvailable, recognizeSpeech } from '@/entry/speech';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { CONTAINER_KIND_LABEL } from '@/domain/container-stats';
import { parseSchedule, type ParsedSchedule } from '@/domain/parse-schedule';
import { describeReminder, describeRepeat, REMINDER_PRESETS, REPEAT_PRESETS } from '@/domain/repeat-next';
import { resolveReminderMinutes } from '@/domain/reminder';
import { decideRoute } from '@/domain/routing';
import { timeAnchor, type RepeatRule, type TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { selectCapabilityGate, useSettings } from '@/state/settings-store';

/** ChoiceSheet 里「不归入任何项目」那一项的 key */
const NO_CONTAINER = '__none__';
/** ChoiceSheet 里「新建项目」那一项的 key */
const NEW_CONTAINER = '__new__';

/** ChoiceSheet 里「不提醒」那一项的 key */
const REMINDER_OFF = '__off__';

/**
 * 快速记录输入条 —— 入口层里最常用的那个。
 *
 * 主交互仍然只有"一个输入框 + 一排 chip"：分类、拆解、排期都不在这里问用户。
 * 四个 chip（时间 / 清单 / 重复 / 提醒）借鉴滴答清单的快捷设置：记的时候顺手定掉，
 * 省得之后再点进详情页补 —— 默认是灰的、不占视觉重量，设过之后才亮起来显示当前值。
 *
 * **时间 chip 是三合一的**（2026-10-07 减负）：以前"自动识别到的时间"单占一行文字，
 * 下方"时间"按钮又说同一件事；现在合成一个 chip —— 有手动值显示手动值，没手动值
 * 显示自动识别的结果，都没有才是占位的「时间」。点它就是把那一刻改成自己想要的，
 * 界面因此少一行，识别结果也从"只读的提示"变成了"能点能改的东西"。
 *
 * **提醒 chip 默认是"不提醒"**（2026-10-08）：它亮起来只有一种原因 ——
 * 这次真的会有通知。文字里写了（"提前半小时提醒我"，`parse-schedule` 认出来）
 * 或者用户自己点过。没提就不发通知，因为默认打扰比默认安静更难挽回：
 * 用户被无用的提醒烦到时，根本不知道去哪儿关掉它。
 */
export interface CaptureOptions {
  asIdea: boolean;
  /** 用户当场指定的时间（覆盖自动识别） */
  time?: TaskTime | null;
  containerId?: string | null;
  repeat?: RepeatRule | null;
  reminderMinutesBefore?: number | null;
  /**
   * 能力层「理解」的结果（开了 AI 才有；没开、失败、答得不成形都是 null）。
   * 拿到就**整份**交给落库那一步用，拿不到就走本地启发式 —— 两条路最终
   * 都汇进 `quickCapture` 的同一套规则里，所以不会出现"AI 一套口径、本地一套"。
   */
  parsed?: ParsedSchedule | null;
  /** 这次的内容里有没有一段是语音说的（落库时记 source = voice） */
  voiceUsed?: boolean;
}

export interface CaptureInputProps {
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  showIdeaToggle?: boolean;
  /**
   * 整条就是"记灵感"用的（想法页）。
   *
   * 想法**不排期、不提醒、不归项目**，所以那四个快捷设置在这儿一个都不该出现 ——
   * 摆着就是误导：用户会去点「时间」，点了才发现"灵感"根本用不上，
   * 于是怀疑是自己哪儿没弄对。既然这一格只有一种归属，界面就只给一种可能。
   */
  ideaOnly?: boolean;
  /** 时间面板顶部的快捷预设（如"今天 18:00"）。不传就只有手选 */
  timePresets?: readonly DateTimePreset[];
  /** 初值：通知栏弹窗深链进来时把原文带过来（app/capture 的 ?text= 参数） */
  initialText?: string;
  /**
   * 挂载后直接提交一次初值（通知栏入口的 ?auto=1）：
   * 用户在弹窗里已经按过「记下来」，这一页只负责落库和给个回执，
   * 再让他按一遍「记下」等于把同一个动作问两次。
   */
  autoSubmit?: boolean;
  /** 语音输入出问题时的一句话往哪送（调用方有地方显示；不传就安静失败） */
  onVoiceError?: (message: string) => void;
  onSubmit: (text: string, options: CaptureOptions) => void | Promise<void>;
}

type Sheet = 'time' | 'list' | 'repeat' | 'reminder' | null;

export function CaptureInput({
  placeholder = '记一件事，或一个念头…',
  autoFocus,
  submitLabel = '记下',
  showIdeaToggle = true,
  ideaOnly = false,
  timePresets,
  initialText,
  autoSubmit = false,
  onVoiceError,
  onSubmit,
}: CaptureInputProps) {
  const theme = useTheme();
  /**
   * 归属项目的候选**直接从 store 读**，不再由调用方传（以前是个 `containers` prop，
   * 但**没有任何一个调用方传过它** —— 于是那个「项目」chip 点开永远是空的，
   * 只剩一句"不归入"。一个 prop 没人传却看着像在生效，比没有更坏）。
   */
  const containers = useAppStore((state) => state.containers);
  /**
   * 功能开关：**项目**和**想法库**这两个快捷入口跟着开关消失。
   *
   * 与别处不同，这里订阅（而不是 `getState()`）：用户刚在设置里拨完开关回来，
   * 这一条必须**立刻**变了样 —— "改动立即生效"是这次的要求，
   * 而输入条重渲染一次的代价远小于"关了还看得见"。
   */
  const features = useSettings((state) => state.features);
  const projectsOn = features.projects ?? true;
  const ideasOn = features.ideas ?? true;
  const [text, setText] = useState(initialText ?? '');
  /** 用户在记录页自己勾的「这是灵感」；想法页不用它（那边 ideaOnly 恒真） */
  const [ideaToggled, setIdeaToggled] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 轻提示（如「AI 没读懂，已按原话保存」）：非阻塞、自退场，不挡记录流 */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice(null);
  }, []);
  /** 语音识别界面开着的这段时间（按钮转圈，别让用户连点开两个） */
  const [listening, setListening] = useState(false);
  /** 这台设备有没有系统语音识别。没有 → 麦克风按钮根本不出现 */
  const speechAvailable = useMemo(() => isSpeechAvailable(), []);
  /** 这一段里有没有内容是语音说的：提交时带进 options，落库记 source = voice */
  const voiceUsedRef = useRef(false);

  /**
   * 想法态：整条就是为灵感生的，或者用户当场勾了。
   *
   * 想法库关掉时那个勾**不会出现**，所以这里也不认它 ——
   * 万一有旧状态残留（或深链带进来），也不能让这条记录悄悄落进一个看不见的库。
   */
  const asIdea = ideaOnly || (ideasOn && ideaToggled);

  /* 快捷设置的草稿：都留到提交那一刻才写库 */
  const [sheet, setSheet] = useState<Sheet>(null);
  const [time, setTime] = useState<TaskTime | null>(null);
  const [draft, setDraft] = useState<DateTimeDraft>(() => defaultDraft());
  const [containerId, setContainerId] = useState<string | null>(null);
  /**
   * 新建项目：**在记录的同时顺手建一个**，不用先跑去项目页建好再回来记。
   * 这是"想归到某个项目、但那个项目还不存在"时的唯一出路 ——
   * 没有它，用户只能二选一：要么先放弃这条记录去建项目，要么先记成无归属再回头挂。
   */
  const [creatingContainer, setCreatingContainer] = useState(false);
  const [newContainerTitle, setNewContainerTitle] = useState('');
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  /**
   * 提醒提前量：**三态**。
   * `undefined` = 用户没动过这一格（这时才轮到"文字里写了什么"和类型默认值），
   * `null` = 用户明确选了「不提醒」（**压过文字里写的**），`number` = 用户选的具体提前量。
   */
  const [reminder, setReminder] = useState<number | null | undefined>(undefined);

  /**
   * 打字时实时解析一遍，把结果直接喂给"时间 chip"和"提醒 chip"（不再另起一行提示）。
   * 用户自己设过时间就不解析了 —— 手动的意思比识别到的更明确。
   *
   * 提醒要在这里一并算出来（而不是等落库时再算）：**chip 上显示的值必须就是
   * 最终会存进库的值**。否则又会出现"界面说提前 10 分钟、实际存的是不提醒"。
   * 所以这里做的是和 `quickCapture` 同一件事：先分流拿到类型，再过
   * `resolveReminderMinutes`（手动 > 文字写明 > 类型默认 > 不提醒）。
   */
  const parsed = useMemo(() => {
    if (asIdea || text.trim().length < 2 || time) return null;
    const result = parseSchedule(text);
    if (!result.time || !result.label) return null;
    const decision = decideRoute({ text: result.title || text, time: result.time });
    const reminder = resolveReminderMinutes({
      parsed: result.reminder,
      parsedUnspecified: result.reminderUnspecified,
      kind: decision.kind,
      attribute: result.time.attribute,
      repeat: result.repeat,
      // 与 quickCapture 传的是同两样：地点的字段值 + 用来找准备动作的原文。
      // 少传一个，chip 上显示的就和最后存进库的不是一个数了。
      location: result.location,
      text,
    });
    return { time: result.time, label: result.label, reminder };
  }, [text, asIdea, time]);

  /**
   * 时间 chip 显示什么：手动设的 > 自动识别的 > 占位「时间」。
   * 识别到的也让它亮起来 —— 用户能看见"系统认出了什么"，而且点一下就能改。
   */
  const timeChipTime = time ?? parsed?.time ?? null;
  const timeChipLabel = timeChipTime ? formatTimeOfTime(timeChipTime) : '时间';

  /**
   * 提醒 chip：手动的 > 文字里认出来的。**默认不提醒** ——
   * 所以它亮起来只有一种原因：这次真的会有通知（文字里写了，或用户点了）。
   */
  const reminderValue = reminder !== undefined ? reminder : (parsed?.reminder ?? null);
  const reminderLabel =
    reminder === null ? '不提醒' : reminderValue == null ? '提醒' : describeReminder(reminderValue);

  const canSubmit = text.trim().length > 0 && !busy;

  /*
   * 自动提交只认初值、只发一次：deep link 冷启动可能重渲染几次，
   * 没有闸的话同一条内容会被记好几遍。初值为空（用户在弹窗里啥都没写
   * 就提交了？不会发生，但万一）就不自动提交，让页面当普通记录页用。
   */
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoSubmit || autoFired.current) return;
    if (!(initialText ?? '').trim()) return;
    autoFired.current = true;
    void submit();
    // 只在挂载时执行一次：提交读的就是初值那一版闭包
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时清掉轻提示的计时器，避免回调一个已卸载的组件
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const reset = () => {
    setText('');
    setIdeaToggled(false);
    setTime(null);
    setContainerId(null);
    setRepeat(null);
    setReminder(undefined);
    setDraft(defaultDraft());
    voiceUsedRef.current = false;
  };

  /**
   * 语音输入（2026-10-13）：弹系统识别界面，把说的话**追加**到输入框里 ——
   * 用户可能已经打了一半，覆盖他就白打了。识别失败/取消都不打断记录流程：
   * 错误只是一句话（有地方显示就显示，没有就安静），字还在输入框里。
   */
  const onVoice = async () => {
    if (listening) return;
    setListening(true);
    try {
      const spoken = (await recognizeSpeech('说话就行')).trim();
      if (!spoken) return;
      voiceUsedRef.current = true;
      setText((prev) => {
        const current = prev.trim();
        return current ? `${current} ${spoken}` : spoken;
      });
    } catch (err) {
      const message = describeSpeechError(err);
      if (message) onVoiceError?.(message);
    } finally {
      setListening(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    dismissNotice();
    setBusy(true);
    try {
      /*
       * 开了「理解」能力，就先让模型读一遍 —— 它比本地正则更认得出
       * "下周三下午的会改到周五了，提前半小时叫我"这种句子。
       *
       * 它**只是加分项**：没开、没配、网络不通、答得不成形，拿到的都是 null，
       * 原样走本地识别。AI 挂掉不能让"记一件事"这件事挂掉。
       *
       * 读的是 `getState()` 而不是订阅 —— 提交是一次性动作，
       * 没必要为它让整条输入条跟着设置重渲染（想法页/记录页都用着它）。
       */
      const gate = selectCapabilityGate(useSettings.getState());
      const understoodReady = !asIdea && isCapabilityReady(gate, AiCapability.Understand);
      const recognized = asIdea
        ? null
        : await understandText(gate, text.trim());

      await onSubmit(text.trim(), {
        asIdea,
        time,
        // 项目关了就不挂容器：挂上一个用户看不见的项目，等于把这条记录藏起来
        containerId: projectsOn ? containerId : null,
        repeat,
        reminderMinutesBefore: reminder,
        parsed: recognized,
        voiceUsed: voiceUsedRef.current,
      });
      reset();
      /*
       * 能力开着却没读懂（网络/格式/答得不成形都落在这）：**不打断记录**，
       * 已经按原话存好了。只给一句自退场的轻提示，让用户知道"AI 今天没帮忙"，
       * 而不是要么静默（用户以为 AI 读懂了）、要么弹重试（把记录变成两道工序）。
       * 能力没开（understoodReady=false）时不提示 —— 那本来就是本地模式，不意外。
       */
      if (understoodReady && !recognized) {
        setNotice('AI 没读懂，已按原话保存');
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(dismissNotice, 2500);
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 归属项目的那份选项：**不归入**排最前（它是默认、也是最常见的答案），
   * **新建**排最后（看完已有项目没有想要的，才轮到它）。
   * 两项都不是"某个已有项目"，但都必须是用户一眼能点到的选择 ——
   * 少了任何一个，这个 chip 都会把人卡住：要么被迫归进某个项目，
   * 要么被迫先离开这一页去建项目、回来时那句话已经忘了。
   */
  const listOptions: ChoiceOption[] = [
    { key: NO_CONTAINER, label: '不归入' },
    ...containers.map((c) => ({
      key: c.id,
      label: c.title,
      hint: CONTAINER_KIND_LABEL[c.kind],
    })),
    { key: NEW_CONTAINER, label: '＋ 新建项目' },
  ];
  const currentContainer = containers.find((c) => c.id === containerId) ?? null;

  /**
   * 建好新项目并**当场选中它**：用户走到"新建"这一步，意图已经明确 ——
   * 这条要归到一个还不存在的项目。建完再让他回列表里点一次是白加的一步。
   * 容器**立刻落库**（与项目页的新建同一口径）：他确实建了个项目，
   * 就算这条记录最后没记成，也不该把项目一并吞掉。
   */
  const confirmNewContainer = async () => {
    const title = newContainerTitle.trim();
    if (!title) return;
    const created = await useAppStore.getState().createContainer({ title });
    setContainerId(created.id);
    setCreatingContainer(false);
    setNewContainerTitle('');
  };

  const repeatOptions: ChoiceOption[] = REPEAT_PRESETS.map((p) => ({
    key: p.id,
    label: p.label,
  }));
  const currentRepeatId =
    REPEAT_PRESETS.find((p) => JSON.stringify(p.rule) === JSON.stringify(repeat))?.id ?? 'none';

  const reminderOptions: ChoiceOption[] = [
    { key: REMINDER_OFF, label: '不提醒' },
    ...REMINDER_PRESETS.map((p) => ({ key: String(p.minutes), label: p.label })),
  ];

  /**
   * 快捷设置那一排。想法态下为 null —— 想法不排期、不提醒、也不归项目，
   * 这四个键摆在那儿只会让人以为"灵感也得定个时间"。
   *
   * 提成变量而不是在 JSX 里写三目：这一排要么整排在、要么整排不在，
   * 塞进三目里会把它下面那几行的缩进全带歪。
   */
  const quickRow = asIdea ? null : (
    <View style={styles.quickRow}>
      <QuickButton
        icon="time-outline"
        label={timeChipLabel}
        active={Boolean(timeChipTime)}
        onPress={() => {
          setDraft(timeChipTime ? draftFromTask({ time: timeChipTime }) : defaultDraft());
          setSheet('time');
        }}
        onClear={time ? () => setTime(null) : undefined}
      />
      {/* 项目关了：这一格不出现（它的列表页也一起没了，留着就是个死链） */}
      {projectsOn ? (
        <QuickButton
          icon="folder-outline"
          label={currentContainer ? currentContainer.title : '项目'}
          active={Boolean(currentContainer)}
          onPress={() => setSheet('list')}
          onClear={currentContainer ? () => setContainerId(null) : undefined}
        />
      ) : null}
      <QuickButton
        icon="repeat-outline"
        label={repeat ? describeRepeat(repeat) : '重复'}
        active={Boolean(repeat)}
        onPress={() => setSheet('repeat')}
        onClear={repeat ? () => setRepeat(null) : undefined}
      />
      <QuickButton
        icon="notifications-outline"
        label={reminderLabel}
        active={reminderValue != null}
        onPress={() => setSheet('reminder')}
        onClear={reminder !== undefined ? () => setReminder(undefined) : undefined}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
      ]}>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          multiline
          style={[styles.input, { color: theme.text }]}
        />
        {/*
          语音输入：夹在输入框和「记下」之间。设备上没有识别组件时整颗不出现 ——
          摆一颗必然失败的按钮，比没有更坏。
        */}
        {speechAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="语音输入"
            disabled={listening || busy}
            onPress={onVoice}
            style={({ pressed }) => [
              styles.voice,
              {
                borderColor: theme.backgroundSelected,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            {listening ? (
              <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
            ) : (
              <Ionicons name="mic-outline" size={18} color={theme.text} />
            )}
          </Pressable>
        ) : null}
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submit,
            {
              backgroundColor: canSubmit ? theme.text : theme.backgroundSelected,
              opacity: busy || pressed ? 0.8 : 1,
            },
          ]}>
          {busy ? (
            <ActivityIndicator
              size="small"
              color={canSubmit ? theme.background : theme.textSecondary}
            />
          ) : (
            <ThemedText
              type="smallBold"
              style={{ color: canSubmit ? theme.background : theme.textSecondary }}>
              {submitLabel}
            </ThemedText>
          )}
        </Pressable>
      </View>

      {/*
        快捷设置：默认是灰的，设过之后亮起来并显示当前值。
        时间那一格同时承担"自动识别的结果"—— 所以它亮不代表用户设过，
        只代表"这条有时间了"。想改就点它，想清掉长按（只有手动值可清）。
        想法态下整排都不出现（见 quickRow 的定义）。
      */}
      {quickRow}

      {/* 想法库关了：这个勾不出现 —— 勾了也不知道东西去了哪儿 */}
      {showIdeaToggle && !ideaOnly && ideasOn ? (
        <Pressable style={styles.toggleRow} onPress={() => setIdeaToggled((v) => !v)}>
          <View
            style={[
              styles.miniCheckbox,
              {
                borderColor: asIdea ? theme.text : theme.textSecondary,
                backgroundColor: asIdea ? theme.text : 'transparent',
              },
            ]}>
            {asIdea ? <Ionicons name="checkmark" size={11} color={theme.background} /> : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            这是灵感（进想法库，不提醒）
          </ThemedText>
        </Pressable>
      ) : null}

      {/*
        轻提示：非阻塞、自退场（2.5 秒或下次提交时清掉），不挡记录流，不算新工序。
        当前只装「AI 没读懂，已按原话保存」一种（见 submit）。
      */}
      {notice ? (
        <View style={styles.notice} pointerEvents="none">
          <ThemedText type="small" themeColor="textSecondary">
            {notice}
          </ThemedText>
        </View>
      ) : null}

      <DateTimeSheet
        visible={sheet === 'time'}
        value={draft}
        onChange={setDraft}
        onCancel={() => setSheet(null)}
        title="什么时候做"
        presets={timePresets}
        onConfirm={(value) => {
          const next = draftToTime(value);
          if (next) setTime(next);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'list'}
        title="归入哪个项目"
        options={listOptions}
        selectedKey={containerId ?? NO_CONTAINER}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          // 「新建」不是选中某一项，是换一条路 —— 收起选择面板、改开输入
          if (key === NEW_CONTAINER) {
            setSheet(null);
            setNewContainerTitle('');
            setCreatingContainer(true);
            return;
          }
          setContainerId(key === NO_CONTAINER ? null : key);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'repeat'}
        title="重复"
        options={repeatOptions}
        selectedKey={currentRepeatId}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          const preset = REPEAT_PRESETS.find((p) => p.id === key);
          setRepeat(preset?.rule ?? null);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'reminder'}
        title="提醒时间"
        options={reminderOptions}
        selectedKey={reminderValue == null ? REMINDER_OFF : String(reminderValue)}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          // 「不提醒」存的是 null，它不是"没设过"（undefined）—— 它会压过文字里写的提醒
          setReminder(key === REMINDER_OFF ? null : Number(key));
          setSheet(null);
        }}
      />

      {/*
        新建项目。**刻意不用 ChoiceSheet**：那是一张"从固定选项里挑一个"的面板，
        这里要的是**输入**。硬塞进去会让那个通用组件长出两副面孔（另外三处用它
        都是纯选择），也会把"挑一个已有的"和"造一个新的"混在同一屏里。
      */}
      <Modal
        visible={creatingContainer}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatingContainer(false)}>
        <Pressable style={styles.newBackdrop} onPress={() => setCreatingContainer(false)}>
          <Pressable
            style={[styles.newBox, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}>
            <ThemedText type="smallBold">新建项目</ThemedText>
            <TextInput
              value={newContainerTitle}
              onChangeText={setNewContainerTitle}
              autoFocus
              placeholder="比如：毕业论文"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={() => void confirmNewContainer()}
              style={[styles.newInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <View style={styles.newActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreatingContainer(false)}
                style={[styles.newBtn, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  取消
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void confirmNewContainer()}
                style={[
                  styles.newBtn,
                  {
                    backgroundColor: newContainerTitle.trim()
                      ? theme.text
                      : theme.backgroundSelected,
                  },
                ]}>
                <ThemedText
                  type="small"
                  style={{
                    color: newContainerTitle.trim() ? theme.background : theme.textSecondary,
                  }}>
                  建好
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** 把已解析出的 TaskTime 显示成"今天 14:00" */
function formatTimeOfTime(time: TaskTime): string {
  const iso = timeAnchor(time);
  if (!iso) return '时间';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '时间';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${sameDay ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`} ${hh}:${mm}`;
}

function QuickButton({
  icon,
  label,
  active,
  onPress,
  onClear,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}（点一下修改）` : label}
      onPress={onPress}
      onLongPress={onClear}
      style={[
        styles.quickButton,
        {
          backgroundColor: active ? theme.backgroundSelected : 'transparent',
          borderColor: active ? theme.backgroundSelected : theme.backgroundSelected,
        },
      ]}>
      <Ionicons
        name={icon}
        size={13}
        color={active ? theme.text : theme.textSecondary}
      />
      <ThemedText
        type="small"
        themeColor={active ? 'text' : 'textSecondary'}
        numberOfLines={1}
        style={styles.quickLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: 4,
    paddingBottom: 4,
  },
  submit: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  voice: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '48%',
  },
  quickLabel: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  miniCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  newBox: {
    width: '100%',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  newInput: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  newActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  newBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
});
