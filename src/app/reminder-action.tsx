import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAppStore } from '@/state/app-store';
import { closeScreen } from '@/utils/navigation';

/**
 * 原生提醒上「完成」按钮的落点（2026-10-13）。
 *
 * 为什么要有这一页：原生通知的动作按钮只能挂 PendingIntent，
 * 而"标记完成"要改数据库 —— 那是 JS 的活，原生不碰库（唯一落库口的规矩不能破）。
 * 所以按钮是**深链打开这一页**，由它调 `completeTask`，然后自己走。
 *
 * 这一页**不给人看**：它是个中转站，做完就关。
 * 唯一会停留的一瞬间是"已完成"那句话 —— 从通知点进来却什么都不出现，
 * 用户会怀疑刚才那一下有没有生效（和记录页那句回执是同一个道理）。
 *
 * 另一种动作「稍后 15 分」根本不经过这里：它只是把提醒挪后，
 * 原生自己排完就把通知撤了，**完全不弹界面** —— "按下按钮就别打扰我"。
 */
export default function ReminderActionScreen() {
  const router = useRouter();
  const { taskId, action, id } = useLocalSearchParams<{
    taskId?: string;
    action?: string;
    id?: string;
  }>();
  const completeTask = useAppStore((state) => state.completeTask);

  /** 只做一次：params 变化不该让"完成"被执行两遍 */
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    // 没带任务 id（理论上不会）：直接走，别留一个空白页
    if (!taskId) {
      closeScreen(router);
      return;
    }

    if (action === 'complete') {
      /*
       * 完成走 store 里那个 `completeTask`，而不是另写一个"改状态"：
       * 重复任务要滚到下一期、频率型要补一次打卡、通知要撤 ——
       * 这些都在那一个动作里。另起炉灶就等于造出第二套完成口径。
       */
      void completeTask(taskId).then(() => closeScreen(router));
      return;
    }

    // 其余（点通知体进来）：把人送到那件事上，自己退场
    router.replace(`/task/${taskId}`);
  }, [action, completeTask, id, router, taskId]);

  return (
    <Screen title="">
      <ThemedText type="small" themeColor="textSecondary">
        {action === 'complete' ? '已完成' : ''}
      </ThemedText>
    </Screen>
  );
}
