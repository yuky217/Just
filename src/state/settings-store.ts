import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { emptyOcrConfig, type OcrConfig } from '@/capabilities/ocr';
import {
  AI_CAPABILITIES,
  defaultCapabilityFlags,
  emptyAiConfig,
  type AiCapability,
  type AiConfig,
  type CapabilityGate,
} from '@/capabilities/types';
import {
  defaultFeatureFlags,
  defaultTabOrder,
  normalizeTabOrder,
  type FeatureFlags,
  type FeatureKey,
  type SortableTabKey,
} from '@/domain/features';
import {
  DEFAULT_SCHEDULE_SCOPE,
  resolveScope,
} from '@/domain/schedule-suggest';

/**
 * 用户偏好设置（主文档第二节设计原则的落点）。
 *
 * 「默认极简，按需展开」「高级功能默认关闭，由用户自己开启」——
 * 所以这里所有高级开关的初值都是 false，且这份设置要持久化，
 * 用户开过一次就不该下次又被重置回去。
 */

export interface SettingsState {
  /** 高级功能总开关：关闭时设置页只看得到基础项 */
  advancedEnabled: boolean;
  /** AI 能力总开关 */
  aiEnabled: boolean;
  /** 单项 AI 能力：用户可以只开"语义检索"不开"自动排期" */
  capabilities: Record<AiCapability, boolean>;
  aiConfig: AiConfig;
  /**
   * 截图 OCR 的接口（2026-10-13）。
   *
   * **空 = 关**，没有一个额外的布尔开关：填了才会联网、才会把图传出去，
   * 不填就当这个功能不存在。这条默认值本身就是隐私上的保护 ——
   * "不想把图传出去的人"什么都不用做。
   */
  ocr: OcrConfig;
  /** 专注默认时长（分钟） */
  defaultFocusMinutes: number;
  /** 触感反馈（勾选完成时的轻微震动） */
  hapticsEnabled: boolean;
  /**
   * 通知栏快速记录入口（Android 独立版）：通知栏里一条常驻通知，
   * 点一下弹输入框。2026-10-13 悬浮球删除后它是唯一系统级快速记录形态，
   * 所以默认**开** —— 默认值要对着"用户已经选定了这条路"，而不是对着一个开关。
   */
  notifyEntryEnabled: boolean;
  /**
   * 专注时间浮条（Android 独立版）：专注中退出应用时，在别的应用之上
   * 浮一条会走字的小条，点它回专注页。默认**开**：用户要的就是这个行为，
   * 开关留给"不想被它打扰"的人。需要「显示在其他应用上层」授权，
   * 第一次触发时由系统弹窗问，设置页里也随时可关。
   */
  focusFloatEnabled: boolean;
  /**
   * 每日提醒：固定每天 8:00 一条"看看今天的安排"。默认关 ——
   * 默认打扰比默认安静更难挽回（与提醒默认值的口径一致）。
   */
  dailyReminderEnabled: boolean;
  /**
   * 日历里要不要课表这一栏。
   *
   * 默认**开**：课表是这个 App 的一块正功能（不是"高级功能"），
   * 而"要不要"多数人自己知道 —— 上班族把它关掉，日历就只剩自己的安排，
   * 学生的日历里则会多出"这段时间有课"这层背景。
   * 关掉不只是藏起「课」那一栏：日/周视图里的课程背景带也一起不画。
   */
  timetableEnabled: boolean;
  /**
   * 简约模式：关掉界面上所有"替自己解释"的文字 ——
   * 页面副标题、卡片上那行小字（hint）、日历底部的形状图例、记录页的提示行。
   *
   * **只关说明书，不关数据**：任务上的时间、提醒几点是内容，把它们关掉
   * App 就没法用了。关的是那些"长按可以拖到…""考试不带完成态…"这类句子 ——
   * 用熟之后它们只剩噪音，而且它们一多，界面就在跟人说话，而不是让人看内容。
   *
   * 默认**开**（2026-10-15 改）：那些句子是给"第一次来的人"写的，而它挡的是
   * 每天都在看的内容 —— 默认安静，想看解释的人自己打开这一项。
   * 它是个开关而不是直接删掉，正因为"有没有用"取决于用户用多久。
   */
  simpleMode: boolean;
  /**
   * AI 排期的两条**范围条件**（2026-10-15）：往后排几天、每天排在哪个时段。
   *
   * **有默认值，可以不调** —— 默认 7 天 · 全天，不碰它的人一次都不用碰；
   * 调过一次就记住，下次还是这个。档位与"必须完整落在时段内"的判定
   * 都在 `domain/schedule-suggest`（`resolveScope` 是唯一口径），这里只存用户选的。
   */
  scheduleWindowDays: number;
  scheduleDayPart: string;
  /**
   * 经期功能偏好（2026-10-14）。
   *
   * 三项都是**默认值已经合理**的数字，用户一般不用动：
   * 周期长度默认 28、经期长度默认 5、提前提醒默认 2 天。
   * 它们只喂给预测与提醒，不参与任何"开/关"判断（开/关由 `features.period` 管）。
   */
  periodCycleLength: number;
  periodLength: number;
  periodReminderDays: number;
  /**
   * 功能开关：哪些功能是开着的（2026-10-13）。
   *
   * 记的是**用户想不想要**，不是"这个功能现在能不能用" —— 后者在界面上由
   * 各入口自己判。默认全开（`defaultFeatureFlags`）：没关就是没关过，
   * **关掉功能不删数据**，所以这个开关随时可以来回拨，没有不可逆的代价。
   */
  features: FeatureFlags;
  /**
   * 底栏几个 Tab 的先后顺序（**不含首页**——它固定在中位，见 `visibleTabs`）。
   * 存的是"其余几个谁先谁后"，首页的位置不在这里，也就不会被拖走。
   */
  tabOrder: SortableTabKey[];

  setFeature: (key: FeatureKey, value: boolean) => void;
  setTabOrder: (order: readonly SortableTabKey[]) => void;
  setAdvancedEnabled: (value: boolean) => void;
  setAiEnabled: (value: boolean) => void;
  toggleCapability: (capability: AiCapability, value: boolean) => void;
  setAiConfig: (patch: Partial<AiConfig>) => void;
  setOcr: (patch: Partial<OcrConfig>) => void;
  setDefaultFocusMinutes: (minutes: number) => void;
  setHapticsEnabled: (value: boolean) => void;
  setNotifyEntryEnabled: (value: boolean) => void;
  setFocusFloatEnabled: (value: boolean) => void;
  setDailyReminderEnabled: (value: boolean) => void;
  setTimetableEnabled: (value: boolean) => void;
  setSimpleMode: (value: boolean) => void;
  setScheduleWindowDays: (days: number) => void;
  setScheduleDayPart: (id: string) => void;
  setPeriodCycleLength: (days: number) => void;
  setPeriodLength: (days: number) => void;
  setPeriodReminderDays: (days: number) => void;
  reset: () => void;
}

const initial = {
  advancedEnabled: false,
  aiEnabled: false,
  capabilities: defaultCapabilityFlags(),
  aiConfig: emptyAiConfig,
  ocr: emptyOcrConfig(),
  defaultFocusMinutes: 25,
  hapticsEnabled: true,
  notifyEntryEnabled: true,
  focusFloatEnabled: true,
  dailyReminderEnabled: false,
  timetableEnabled: true,
  simpleMode: true,
  scheduleWindowDays: DEFAULT_SCHEDULE_SCOPE.windowDays,
  scheduleDayPart: DEFAULT_SCHEDULE_SCOPE.dayPartId,
  periodCycleLength: 28,
  periodLength: 5,
  periodReminderDays: 2,
  features: defaultFeatureFlags(),
  tabOrder: defaultTabOrder(),
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...initial,

      setAdvancedEnabled: (value) => set({ advancedEnabled: value }),

      // 关掉 AI 总开关时，把单项能力一并关掉，避免"总开关关了但某项还在跑"
      setAiEnabled: (value) =>
        set((state) => ({
          aiEnabled: value,
          capabilities: value ? state.capabilities : defaultCapabilityFlags(),
        })),

      toggleCapability: (capability, value) =>
        set((state) => ({
          capabilities: { ...state.capabilities, [capability]: value },
        })),

      setAiConfig: (patch) => set((state) => ({ aiConfig: { ...state.aiConfig, ...patch } })),

      setOcr: (patch) => set((state) => ({ ocr: { ...state.ocr, ...patch } })),

      setDefaultFocusMinutes: (minutes) =>
        set({ defaultFocusMinutes: Math.max(1, Math.round(minutes)) }),

      setHapticsEnabled: (value) => set({ hapticsEnabled: value }),

      setNotifyEntryEnabled: (value) => set({ notifyEntryEnabled: value }),

      setFocusFloatEnabled: (value) => set({ focusFloatEnabled: value }),

      setDailyReminderEnabled: (value) => set({ dailyReminderEnabled: value }),

      setTimetableEnabled: (value) => set({ timetableEnabled: value }),

      setSimpleMode: (value) => set({ simpleMode: value }),

      // 档位合法性交给 resolveScope（唯一口径），这里不自己 clamp 一遍
      setScheduleWindowDays: (days) =>
        set({ scheduleWindowDays: resolveScope({ windowDays: days }).windowDays }),
      setScheduleDayPart: (id) => set({ scheduleDayPart: resolveScope({ dayPartId: id }).dayPartId }),

      setPeriodCycleLength: (days) =>
        set({ periodCycleLength: Math.min(60, Math.max(15, Math.round(days))) }),
      setPeriodLength: (days) =>
        set({ periodLength: Math.min(14, Math.max(1, Math.round(days))) }),
      setPeriodReminderDays: (days) =>
        set({ periodReminderDays: Math.min(10, Math.max(0, Math.round(days))) }),

      setFeature: (key, value) =>
        set((state) => ({ features: { ...state.features, [key]: value } })),

      setTabOrder: (order) => set({ tabOrder: normalizeTabOrder(order) }),

      reset: () =>
        set({
          ...initial,
          capabilities: defaultCapabilityFlags(),
          aiConfig: emptyAiConfig,
          ocr: emptyOcrConfig(),
          features: defaultFeatureFlags(),
          tabOrder: defaultTabOrder(),
        }),
      // 注：period* 三个字段已在 initial 里，reset 会一并回到默认
    }),
    {
      name: 'ai-schedule-settings',
      /**
       * version 2（2026-10-15）：简约模式的默认改成**开**。
       *
       * 老存档里那条 `false` 不是"用户说过不要"，它只是当时的默认值 ——
       * 光改 initial 的话，已经装过的人永远看不到这次变化。所以升级时翻成开。
       * 之后用户再拨就是他自己的意思（version 已是 2，不会再被迁）。
       */
      version: 2,
      migrate: (persisted, version) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>;
        return (version < 2 ? { ...saved, simpleMode: true } : saved) as SettingsState;
      },
      storage: createJSONStorage(() => AsyncStorage),
      // 旧版本没有的字段用默认值补齐，避免升级后读到 undefined
      merge: (persisted, current) => {
        const saved = { ...((persisted ?? {}) as Partial<SettingsState>) };
        // 悬浮球（overlayEnabled）2026-10-13 已删：旧存档里的这个键直接丢掉，
        // 不往新 state 上挂一个没人读的属性
        delete (saved as Record<string, unknown>).overlayEnabled;
        return {
          ...current,
          ...saved,
          capabilities: { ...defaultCapabilityFlags(), ...(saved.capabilities ?? {}) },
          aiConfig: { ...emptyAiConfig, ...(saved.aiConfig ?? {}) },
          // OCR：旧存档没有 → 空（= 关）。这里**不能**默认开：开了就意味着联网传图
          ocr: { ...emptyOcrConfig(), ...(saved.ocr ?? {}) },
          // 功能开关：旧存档没有这项 → 全开（"没说过不要"就是还要）；
          // 将来加了新功能键，也靠这份兜底默认开，而不是 undefined 把界面整片藏掉
          features: { ...defaultFeatureFlags(), ...(saved.features ?? {}) },
          // Tab 顺序：缺项补末尾、多的丢掉（normalizeTabOrder 保证画得出完整底栏）
          tabOrder: normalizeTabOrder(saved.tabOrder),
        };
      },
    },
  ),
);

/**
 * 功能开没开 —— 界面上判"这个入口该不该出现"就用它，别自己去读 features。
 *
 * 读不到（旧存档 / 测试中）时按**开**处理：默认全开是这一整套的立场，
 * 宁可多显示一个入口，也不要因为一个 undefined 把整片功能藏掉。
 */
export const useFeature = (key: FeatureKey): boolean =>
  useSettings((state) => state.features[key] ?? true);

/** 给能力层用的开关视图 */
export const selectCapabilityGate = (state: SettingsState): CapabilityGate => ({
  // 总开关关闭时，单项视为全关
  enabled: state.aiEnabled ? state.capabilities : defaultCapabilityFlags(),
  config: state.aiConfig,
});

export const isAnyAiEnabled = (state: SettingsState): boolean =>
  state.aiEnabled && AI_CAPABILITIES.some((cap) => state.capabilities[cap.id]);
