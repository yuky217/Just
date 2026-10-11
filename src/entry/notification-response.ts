import { Platform } from 'react-native';

import { taskRepository } from '@/data/repositories/task-repository';
import { useAppStore } from '@/state/app-store';

import { addReminderResponseListener, scheduleSnoozedReminder } from './notifications';

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
 * 已知边界：App 被系统杀掉后按钮无效（原生兜底 receiver 后补，方案 §4）。
 */
let registered = false;

export function registerReminderActions(): void {
  if (registered) return;
  if (Platform.OS === 'web') return; // 网页端没有通知，也不该把 store 拖进来初始化
  registered = true;

  addReminderResponseListener(async (taskId, action) => {
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
  });
}
