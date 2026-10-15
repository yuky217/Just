import { requireOptionalNativeModule } from 'expo-modules-core';

import type { ReminderLevel } from '@/domain/reminder';

/**
 * 原生提醒通道的 JS 侧（2026-10-13）。
 *
 * **它只接"重要 / 截止"两档**，普通提醒仍然走 expo（见 notifications.ts）。
 * 这样分是因为：expo 那条路已经被真机验过（包括"App 被杀后按钮依然有效"），
 * 而原生这条路能多做三件事 —— 顶部横幅、全屏弹窗、闹钟分类（穿勿扰）。
 * 为了这三件事把整条提醒链路换掉，不划算也不安全。
 *
 * 用 `requireOptionalNativeModule` 而不是 `requireNativeModule`：
 * iOS / Web / Expo Go 里根本没有这个模块，**拿不到 = 能力不存在**，
 * 而不是抛一个把整个入口层炸掉的错。拿不到时这里全部返回 false，
 * 调用方自然退回 expo 那条路 —— 降级是默认的，不是异常分支。
 */

interface ReminderNativeModule {
  ensureChannels: () => Promise<boolean>;
  schedule: (
    id: string,
    title: string,
    body: string,
    atMillis: number,
    level: string,
    taskId: string,
  ) => Promise<boolean>;
  cancel: (id: string, taskId: string) => Promise<boolean>;
  cancelTask: (taskId: string) => Promise<boolean>;
  cancelAll: () => Promise<boolean>;
  canScheduleExact: () => boolean;
  openDndSettings: () => Promise<boolean>;
  openAlarmSettings: () => Promise<boolean>;
}

const native = requireOptionalNativeModule<ReminderNativeModule>('Reminder');

export function nativeReminderAvailable(): boolean {
  return native != null;
}

/**
 * 提醒 id。
 *
 * 用 `任务id|期数时刻` 而不是随机数：同一条任务的同一期反复排（改时间、冷启动补排）
 * 得到的是同一个 id，撤销才撤得干净；随机 id 每排一次就多一条漏撤的。
 */
export function nativeReminderId(taskId: string, fireAt: Date): string {
  return `${taskId}|${fireAt.getTime()}`;
}

export async function scheduleNativeReminder(args: {
  id: string;
  title: string;
  body: string;
  at: Date;
  level: ReminderLevel;
  taskId: string;
}): Promise<boolean> {
  if (!native) return false;
  try {
    await native.ensureChannels();
    return await native.schedule(
      args.id,
      args.title,
      args.body,
      args.at.getTime(),
      args.level,
      args.taskId,
    );
  } catch {
    return false;
  }
}

export async function cancelNativeReminder(id: string, taskId: string): Promise<void> {
  if (!native) return;
  try {
    await native.cancel(id, taskId);
  } catch {
    // 撤不掉最多是这条提醒还会响一次；别把"改个时间"整件事搞砸
  }
}

/** 撤掉一条任务的全部期 —— 改时间 / 完成 / 删除都走它 */
export async function cancelNativeTaskReminders(taskId: string): Promise<void> {
  if (!native) return;
  try {
    await native.cancelTask(taskId);
  } catch {
    // 同上
  }
}

/** 全撤（覆盖导入之后用）：库整体换血，分不清哪条旧提醒还作数 */
export async function cancelAllNativeReminders(): Promise<void> {
  if (!native) return;
  try {
    await native.cancelAll();
  } catch {
    // 同上
  }
}

/**
 * 现在排的闹钟是不是"精确到点"。
 *
 * Android 14 起普通应用默认拿不到精确闹钟权限，这时会**降级成不精确**
 * （最多晚几分钟）。界面上要如实说，别让人以为"设了 9:00 就 9:00 响"。
 */
export function canScheduleExact(): boolean {
  if (!native) return false;
  try {
    return native.canScheduleExact();
  } catch {
    return false;
  }
}

/**
 * 跳系统设置开"勿扰例外"。
 *
 * ⚠️ 这个权限代码要不到，只能把人送过去自己开 —— 所以返回"有没有跳成功"，
 * 而不是"开没开"。界面上的文案因此是"去系统设置里开"，不是"已开启"。
 */
export async function openDndSettings(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.openDndSettings();
  } catch {
    return false;
  }
}

/** 跳系统设置的"闹钟与提醒"页（Android 12+ 的精确闹钟在那儿） */
export async function openAlarmSettings(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.openAlarmSettings();
  } catch {
    return false;
  }
}
