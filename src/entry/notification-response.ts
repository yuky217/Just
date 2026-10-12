import { Platform } from 'react-native';

import { taskRepository } from '@/data/repositories/task-repository';
import { useAppStore } from '@/state/app-store';

import {
  addReminderResponseListener,
  scheduleSnoozedReminder,
  takeLastReminderResponse,
  type PendingReminderResponse,
} from './notifications';

/**
 * 提醒通知按钮的接线 —— 「完成 / 稍后15分 / 稍后1小时」点了之后发生什么。
 *
 * 为什么单独一个文件：动作落在 app-store（completeTask 会触发对账、刷新、
 * 重推小组件），而 `notifications.ts` 被 app-store 依赖着 —— 在那里 import
 * store 就是循环依赖。这里反向指着两头，谁都不绕。
 *
 * 什么时候被调：`app/_layout.tsx` 模块加载时注册一次。按钮点击发生在
 * 任何页面之外，订阅必须跟着 App 启动就走，不能等某个页面挂载。
 *
 * ⭐ **两条路都得接**（2026-10-12 补）：本文件此前只有订阅这一条，
 * 于是"App 被系统杀掉后点按钮没反应"。
 * - 订阅 → 管"点的时候 App 还活着"（前台或后台）；
 * - 冷启动读一次「上一次响应」→ 管"点的时候 App 已经被杀"，
 *   那次点击只留在原生侧的 `lastNotificationResponse` 里（详见
 *   `notifications.takeLastReminderResponse` 的注释）。
 *
 * 两条路**可能同时**赶上同一次点击（订阅晚挂上时事件已经被记成"上一次"），
 * 所以按 `key` 去重：`complete` 重复执行没副作用，但 `snooze` 会多排一条提醒。
 */
let registered = false;

export function registerReminderActions(): void {
  if (registered) return;
  if (Platform.OS === 'web') return; // 网页端没有通知，也不该把 store 拖进来初始化
  registered = true;

  /** 这次运行里处理过的点击（见上面"两条路"那段） */
  const handled = new Set<string>();

  const handle = async ({ taskId, action, key }: PendingReminderResponse) => {
    if (handled.has(key)) return;
    handled.add(key);
    try {
      if (action === 'complete') {
        await useAppStore.getState().completeTask(taskId);
        return;
      }
      const task = await taskRepository.getById(taskId);
      if (task) await scheduleSnoozedReminder(task, action === 'snooze15' ? 15 : 60);
    } catch {
      // 按钮处理失败就失败 —— 通知已经弹过了，任务还在 App 里
    }
  };

  addReminderResponseListener((response) => void handle(response));

  // 冷启动：这一次启动很可能就是"点按钮"点起来的，而那一刻我们的订阅还没挂上
  void takeLastReminderResponse().then((response) => {
    if (response) void handle(response);
  });
}
