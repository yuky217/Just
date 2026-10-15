import { requireOptionalNativeModule } from 'expo-modules-core';
import { Linking, Platform } from 'react-native';

import { ensureNotificationPermission, getReminderSupport } from './notifications';

/**
 * 入口层在 Android 上的原生形态（主文档的「记录无感」）。
 *
 * 2026-10-13 起只剩两件（悬浮球已删，见 `modules/overlay` 的模块注释）：
 * ① **通知栏常驻入口** —— 点一下弹透明输入框，记完走深链落库；
 * ② **专注时间浮条** —— 专注中退出应用时浮一条会走字的小条，点它回专注页。
 *
 * 为什么不并进 `notifications.ts`：它们是两种不同的"能力可能不存在"。
 * 提醒是**系统授权**问题；这里是**打包形态**问题 —— 它们是原生模块，
 * 网页端和 Expo Go 里根本不存在，只有独立安装的 Android 版才有。
 * 混在一起写，会让"能力层"这件事变得说不清。
 *
 * 三条纪律，跟提醒卡一致：
 * ① **探真实状态，不靠猜**。`getFocusBarSupport()` / `getNotifyEntrySupport()`
 *    读的是原生侧的实际值（权限给没给、东西在不在），不是本地记的"用户点过开关"。
 * ② **拿不到原生模块就降级**，不抛异常、不拖垮页面 ——
 *    网页端渲染设置页时这条路径每次都会走到。
 * ③ 用户意愿（要不要开）由 `state/settings-store` 持久化；这里只负责"做得到做不到"。
 */

/** 原生模块暴露的接口，与 `modules/overlay` 里的 ModuleDefinition 一一对应 */
type OverlayNativeModule = {
  canDrawOverlays: () => boolean;
  requestPermission: () => Promise<boolean>;
  /** 通知栏入口：那条常驻通知发出去没有 */
  isEntryShowing: () => boolean;
  showEntry: () => Promise<boolean>;
  hideEntry: () => Promise<boolean>;
  /** 专注时间浮条：现在浮着没有（转瞬状态，仅供设置页显示） */
  isFocusBarShowing: () => boolean;
  showFocusBar: (
    startedAtMs: number,
    accumulatedMs: number,
    paused: boolean,
  ) => Promise<boolean>;
  hideFocusBar: () => Promise<boolean>;
};

export type OverlayStatus =
  /** 权限齐了，开得起来 */
  | 'ready'
  /** 差"显示在其他应用上层"这个授权 */
  | 'need-permission'
  /** 这个形态下没有这个能力（网页端 / Expo Go / iOS） */
  | 'unavailable';

export interface OverlaySupport {
  status: OverlayStatus;
  /** 浮条是不是正浮着 */
  showing: boolean;
  /** 给界面直接显示的一句话 */
  message: string;
}

let cached: OverlayNativeModule | null | undefined;

/**
 * 拿原生模块。找不到就返回 null —— 不抛。
 * 缓存在模块作用域里：这个值一辈子不会变，没必要每次进设置页都问一遍。
 */
function native(): OverlayNativeModule | null {
  if (Platform.OS !== 'android') return null;
  if (cached !== undefined) return cached;
  try {
    cached = requireOptionalNativeModule<OverlayNativeModule>('Overlay') ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/*
 * ---------------- 专注时间浮条（2026-10-13） ----------------
 *
 * 授权门与通知栏入口**不同**：浮条要画在别的应用之上，必须
 * 「显示在其他应用上层」；跳系统授权页的结果没有原生回调，
 * 由设置页监听 AppState 回前台时重探状态收口。
 */

/** 探查浮条的真实状态。设置页进来探一次，之后每次回前台再探。 */
export async function getFocusBarSupport(): Promise<OverlaySupport> {
  const mod = native();
  if (!mod) {
    return {
      status: 'unavailable',
      showing: false,
      message:
        Platform.OS === 'android'
          ? '要装独立安装版才有；Expo Go 和网页端都缺原生模块'
          : '浮条只有 Android 有；iOS 不允许应用画在别的应用之上',
    };
  }
  try {
    if (!mod.canDrawOverlays()) {
      return {
        status: 'need-permission',
        showing: false,
        message: '还差一步授权：允许「显示在其他应用上层」',
      };
    }
    return {
      status: 'ready',
      showing: mod.isFocusBarShowing(),
      message: '专注中退出应用，会浮一条时间条',
    };
  } catch {
    return { status: 'unavailable', showing: false, message: '当前环境下用不了' };
  }
}

/** 直接跳到授权页（设置页里拨开关时用） */
export async function requestOverlayPermission(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    await mod.requestPermission();
    return true;
  } catch {
    return false;
  }
}

/** 专注页在退后台时调：把浮条画出来。返回有没有真的画出来 */
export async function showFocusBar(state: {
  /** 虚拟起点：跑着的时候 = now - 已跑时长（原生据此每秒现算） */
  startedAtMs: number;
  /** 暂停前已攒的时长（ms）；跑着的时候传 0 */
  accumulatedMs: number;
  paused: boolean;
}): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    return await mod.showFocusBar(state.startedAtMs, state.accumulatedMs, state.paused);
  } catch {
    return false;
  }
}

/** 回前台 / 专注结束时调：把浮条收起来。幂等，重复调无副作用 */
export async function hideFocusBar(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.hideFocusBar();
  } catch {
    // 收不起来就算了：回前台时它挡着的是自己的 App，下一轮 focus 会重画
  }
}

/** 深链地址。原生侧那份在 `FocusBar.FOCUS_URL`，两处必须一致。 */
export const OVERLAY_CAPTURE_URL = 'aischedule://capture';

/** 给"点通知/点浮条之后到底去了哪"兜底：解析出问题就直接开记录页 */
export async function openCaptureDeepLink(): Promise<boolean> {
  try {
    const supported = await Linking.canOpenURL(OVERLAY_CAPTURE_URL);
    if (!supported) return false;
    await Linking.openURL(OVERLAY_CAPTURE_URL);
    return true;
  } catch {
    return false;
  }
}

/*
 * ---------------- 通知栏入口（2026-10-11 第二批，2026-10-13 起是唯一快速记录入口） ----------------
 *
 * 悬浮球删除后它成为"快速记录"的唯一系统级形态：通知栏里常驻一条，
 * 点一下弹 CaptureDialogActivity，记完走 aischedule://capture?text=&auto=1 落库。
 *
 * 授权门与浮条不同：它**不需要**"显示在其他应用上层"（不画窗口），
 * 要的是**通知权限** —— 点通知拉起的 Activity 是普通 Activity，
 * Android 10+ 的后台启动限制由"用户点了通知"这件事豁免。
 */

export type NotifyEntryStatus =
  /** 通知权限已给，通知发得出去 */
  | 'ready'
  /** 差通知权限 */
  | 'need-permission'
  /** 这个形态下没有这个能力（网页端 / Expo Go / iOS） */
  | 'unavailable';

export interface NotifyEntrySupport {
  status: NotifyEntryStatus;
  /** 那条常驻通知现在在不在通知栏里 */
  showing: boolean;
  /** 给界面直接显示的一句话 */
  message: string;
}

/**
 * 探查通知栏入口的真实状态。**不弹权限框** —— 只想看状态时不该打扰用户。
 * 通知权限借 `getReminderSupport()` 读：两边要的是同一个授权，别各问各的。
 */
export async function getNotifyEntrySupport(): Promise<NotifyEntrySupport> {
  const mod = native();
  if (!mod) {
    return {
      status: 'unavailable',
      showing: false,
      message:
        Platform.OS === 'android'
          ? '要装独立安装版才有；Expo Go 和网页端都缺原生模块'
          : '通知栏入口只有 Android 有',
    };
  }
  try {
    const reminder = await getReminderSupport();
    if (!reminder.moduleAvailable) {
      return { status: 'unavailable', showing: false, message: '这台设备用不了本地通知' };
    }
    if (!reminder.granted) {
      return {
        status: 'need-permission',
        showing: Boolean(mod.isEntryShowing()),
        message: '还差一步授权：允许 JUST 发通知',
      };
    }
    const showing = mod.isEntryShowing();
    return {
      status: 'ready',
      showing,
      message: showing ? '通知栏里常驻一条入口，点一下直接打字' : '现在没开',
    };
  } catch {
    return { status: 'unavailable', showing: false, message: '当前环境下用不了' };
  }
}

/**
 * 开启。通知权限没给就先弹授权框（这是本形态唯一的授权门）；
 * 授权了就发那条常驻通知。
 */
export async function enableNotifyEntry(): Promise<NotifyEntrySupport> {
  const mod = native();
  if (!mod) return getNotifyEntrySupport();
  try {
    if (await ensureNotificationPermission()) {
      await mod.showEntry();
    }
  } catch {
    // 发不出去就让 getNotifyEntrySupport 如实报告
  }
  return getNotifyEntrySupport();
}

export async function disableNotifyEntry(): Promise<NotifyEntrySupport> {
  const mod = native();
  if (mod) {
    try {
      await mod.hideEntry();
    } catch {
      // 同上
    }
  }
  return getNotifyEntrySupport();
}

/**
 * 启动时按用户上次的选择恢复通知（手机重启 / 强制停止后系统会撤掉它）。
 *
 * 为什么需要它：用户开过一次之后，不该因为 App 重启就得再去设置页点一次。
 * 开一次就一直在，才叫简单。用户没开过（`enabled === false`）时什么都不做。
 */
export async function restoreNotifyEntryIfEnabled(enabled: boolean): Promise<void> {
  if (!enabled) return;
  const mod = native();
  if (!mod) return;
  try {
    if (mod.isEntryShowing()) return;
    // 权限被撤销时 show 不进去，isShowing() 会如实反映，设置页照常显示
    if (await ensureNotificationPermission()) await mod.showEntry();
  } catch {
    // 恢复失败不是错误
  }
}
