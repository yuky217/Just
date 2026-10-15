import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskKind, TaskStatus, TimeAttribute, RepeatFreq } from '@/domain/enums';
import type { Task } from '@/domain/task';

import {
  parseReminderResponse,
  REMINDER_CHANNEL_IMPORTANT,
  REMINDER_CHANNEL_NORMAL,
  scheduleTaskReminder,
  syncEventReminders,
  syncRepeatingTaskReminders,
  takeLastReminderResponse,
} from './notifications';

/**
 * 调度层（entry）的测试网。
 *
 * domain 那边钉住了"该在哪几个时刻响"，这里钉的是**真正排出去与撤掉的范围**：
 * 排几条、每条带什么 taskId、撤的时候会不会误伤别的任务/课程/考试。
 * 这一层以前靠肉眼，而它恰恰有两个"安静地做错"的方向：
 * 排少了（重复提醒只有今天响）和撤多了（把别人的提醒一起干掉）。
 */

/** 假的通知系统：记下排了什么、谁还在 */
const fake = vi.hoisted(() => ({
  store: new Map<
    string,
    { title: string; body: string; data: Record<string, unknown>; channelId?: string }
  >(),
  seq: 0,
  permission: { granted: true } as { granted: boolean },
  /** 原生侧那份「上一次被点掉的通知响应」 */
  lastResponse: null as {
    requestId: string;
    actionIdentifier: string;
    data: Record<string, unknown>;
  } | null,
  /** 被清过几次 —— 读一次就该清一次，靠它验"读走不留" */
  clearCount: 0,
}));

vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  LogBox: { ignoreLogs: () => {} },
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 6 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval', DAILY: 'daily' },
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => fake.permission,
  requestPermissionsAsync: async () => fake.permission,
  scheduleNotificationAsync: async (req: {
    content: { title: string; body: string; data: Record<string, unknown> };
    trigger?: { channelId?: string };
  }) => {
    const id = `n${(fake.seq += 1)}`;
    fake.store.set(id, {
      title: req.content.title,
      body: req.content.body,
      data: req.content.data,
      channelId: req.trigger?.channelId,
    });
    return id;
  },
  getAllScheduledNotificationsAsync: async () =>
    [...fake.store.entries()].map(([identifier, item]) => ({
      identifier,
      content: { title: item.title, body: item.body, data: item.data },
    })),
  cancelScheduledNotificationAsync: async (id: string) => {
    fake.store.delete(id);
  },
  // 「上一次被点掉的通知响应」—— App 被杀时点按钮，只留下这一份
  getLastNotificationResponse: () => {
    const last = fake.lastResponse;
    if (!last) return null;
    return {
      actionIdentifier: last.actionIdentifier,
      notification: {
        request: { identifier: last.requestId, content: { data: last.data } },
      },
    };
  },
  clearLastNotificationResponse: () => {
    fake.lastResponse = null;
    fake.clearCount += 1;
  },
}));

// 原生提醒通道在 node 测试环境里没有对应的原生模块（expo-modules-core 顶层
// 会读 __DEV__ 直接崩）。把它桩成"不可用"，调度逻辑自然退回 expo 那条路 ——
// 这条路的排/撤行为才是本测试要钉死的东西。
vi.mock('./native-reminders', () => ({
  nativeReminderAvailable: () => false,
  nativeReminderId: (taskId: string, fireAt: Date) => `${taskId}|${fireAt.getTime()}`,
  scheduleNativeReminder: async () => false,
  cancelNativeReminder: async () => {},
  cancelNativeTaskReminders: async () => {},
  cancelAllNativeReminders: async () => {},
}));

/** 周三中午 —— 与 reminder.test.ts 用同一时刻，两边算出的期能对得上 */
const NOW = new Date(2026, 9, 7, 12, 0);

/** 排出去的提醒里，属于某个 taskId 的条数 */
const countFor = (taskId: string) =>
  [...fake.store.values()].filter((item) => item.data.taskId === taskId).length;

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: '测试',
    kind: TaskKind.Schedule,
    status: TaskStatus.Todo,
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: new Date(2026, 9, 7, 20, 0).toISOString(),
      endAt: null,
      dueAt: null,
    },
    ...overrides,
  } as Task;
}

const DAILY = { freq: RepeatFreq.Daily, interval: 1 } as const;

beforeEach(() => {
  fake.store.clear();
  fake.seq = 0;
  fake.permission = { granted: true };
  fake.lastResponse = null;
  fake.clearCount = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('scheduleTaskReminder', () => {
  it('重复任务：一次把未来几期全排上，每期都带同一个 taskId', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'a', reminderMinutesBefore: 0, repeat: DAILY }));

    // 10/7 20:00 到今天中午还没到，往后排满 7 天窗口
    expect(ids).toHaveLength(7);
    expect(countFor('a')).toBe(7);
  });

  it('单次任务：只排一条', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'b', reminderMinutesBefore: 10 }));
    expect(ids).toHaveLength(1);
    expect(countFor('b')).toBe(1);
  });

  it('没设提醒 → 一条都不排，而且连权限都不问（默认安静）', async () => {
    const ids = await scheduleTaskReminder(task({ id: 'c' }));
    expect(ids).toEqual([]);
    expect(fake.store.size).toBe(0);
  });
});

describe('scheduleTaskReminder 铃声渠道两档', () => {
  const channelOf = (taskId: string) =>
    [...fake.store.values()].find((item) => item.data.taskId === taskId)?.channelId;

  it('普通日程 → 普通渠道', async () => {
    await scheduleTaskReminder(task({ id: 'nrm', reminderMinutesBefore: 10 }));
    expect(channelOf('nrm')).toBe(REMINDER_CHANNEL_NORMAL);
  });

  it('出发类（标题含准备动作词，defaultReminderMinutes 判 60）→ 重要渠道', async () => {
    await scheduleTaskReminder(
      task({ id: 'dep', reminderMinutesBefore: 10, title: '19:00 出发去机场' }),
    );
    expect(channelOf('dep')).toBe(REMINDER_CHANNEL_IMPORTANT);
  });

  it('临近的截止（24h 内）→ 重要渠道', async () => {
    const soon = new Date(NOW.getTime() + 2 * 3600 * 1000);
    await scheduleTaskReminder(
      task({
        id: 'dl',
        reminderMinutesBefore: 0,
        time: { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: soon.toISOString() },
      }),
    );
    expect(channelOf('dl')).toBe(REMINDER_CHANNEL_IMPORTANT);
  });

  it('遥远的截止（>24h）→ 普通渠道（远未来的截止不该现在就响得急）', async () => {
    const far = new Date(NOW.getTime() + 10 * 24 * 3600 * 1000);
    await scheduleTaskReminder(
      task({
        id: 'fardl',
        reminderMinutesBefore: 0,
        time: { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: far.toISOString() },
      }),
    );
    expect(channelOf('fardl')).toBe(REMINDER_CHANNEL_NORMAL);
  });
});

describe('syncEventReminders 铃声渠道', () => {
  it('考试 → 重要渠道', async () => {
    const event = {
      id: 'e1',
      title: '高数期中',
      startAt: new Date(NOW.getTime() + 2 * 24 * 3600 * 1000).toISOString(),
      deletedAt: null,
    } as import('@/domain/event').CalEvent;

    const count = await syncEventReminders([event]);
    expect(count).toBe(1);
    expect([...fake.store.values()][0]?.channelId).toBe(REMINDER_CHANNEL_IMPORTANT);
  });
});

describe('syncRepeatingTaskReminders', () => {
  it('补排重复任务的窗口，且**不碰**别人的通知（单次任务 / 课程 / 考试）', async () => {
    // 先摆好三类"别人的"通知：单次任务、课程、考试
    fake.store.set('one', { title: '单次', body: '', data: { taskId: 'once' } });
    fake.store.set('course', { title: '课', body: '', data: { courseId: 'c1' } });
    fake.store.set('exam', { title: '考试', body: '', data: { eventId: 'e1' } });
    // 重复任务的旧通知（窗口过期了，应该被撤掉重排）
    fake.store.set('old', { title: '吃药', body: '', data: { taskId: 'med' } });

    const count = await syncRepeatingTaskReminders([
      task({ id: 'med', reminderMinutesBefore: 0, repeat: DAILY }),
      task({ id: 'once', reminderMinutesBefore: 0 }),
      // 重复但没设提醒 → 不排
      task({ id: 'quiet', repeat: DAILY }),
      // 已完成的重复任务 → 不排
      task({ id: 'done', reminderMinutesBefore: 0, repeat: DAILY, status: TaskStatus.Done }),
    ]);

    expect(count).toBe(7);
    expect(countFor('med')).toBe(7);
    expect(fake.store.has('old')).toBe(false);

    expect(fake.store.has('one')).toBe(true);
    expect(fake.store.has('course')).toBe(true);
    expect(fake.store.has('exam')).toBe(true);
    expect(countFor('quiet')).toBe(0);
    expect(countFor('done')).toBe(0);
  });

  it('没有重复任务 → 什么都不做（连既有通知都不动）', async () => {
    fake.store.set('one', { title: '单次', body: '', data: { taskId: 'once' } });
    expect(await syncRepeatingTaskReminders([task({ id: 'once', reminderMinutesBefore: 0 })])).toBe(0);
    expect(fake.store.has('one')).toBe(true);
  });

  it('没拿到通知权限 → 不排，也**不弹权限框**（启动补排不得打扰用户）', async () => {
    fake.permission = { granted: false };
    const count = await syncRepeatingTaskReminders([
      task({ id: 'med', reminderMinutesBefore: 0, repeat: DAILY }),
    ]);
    expect(count).toBe(0);
    expect(fake.store.size).toBe(0);
  });
});

/**
 * 通知按钮的「翻译」与「被杀之后怎么捞回来」。
 *
 * 这两件事以前既没测也没接线：按钮点了会发生什么，全靠一条订阅 ——
 * 而订阅只在 App 还活着时有效。App 被系统杀掉后点按钮，那次点击只剩一份
 * 「上一次的响应」留在原生侧，没人读就等于丢了（README 里那条已知限制）。
 */
describe('parseReminderResponse', () => {
  it('三个按钮都认得出来', () => {
    expect(parseReminderResponse('complete', { taskId: 't1' })).toEqual({
      taskId: 't1',
      action: 'complete',
    });
    expect(parseReminderResponse('snooze15', { taskId: 't1' })).toEqual({
      taskId: 't1',
      action: 'snooze15',
    });
    expect(parseReminderResponse('snooze60', { taskId: 't1' })).toEqual({
      taskId: 't1',
      action: 'snooze60',
    });
  });

  it('点通知本体不算动作 —— 交给系统默认行为：打开 App', () => {
    expect(
      parseReminderResponse('expo.modules.notifications.actions.DEFAULT', { taskId: 't1' }),
    ).toBeNull();
  });

  it('通知上没带 taskId 的不处理（每日提醒那条就不是任务）', () => {
    expect(parseReminderResponse('complete', {})).toBeNull();
    expect(parseReminderResponse('complete', undefined)).toBeNull();
  });

  it('认不出的动作 id 返回 null —— 不猜', () => {
    expect(parseReminderResponse('markDone', { taskId: 't1' })).toBeNull();
  });
});

describe('takeLastReminderResponse', () => {
  it('⭐ 能把"App 被杀时点掉的按钮"捞回来（这条就是那个已知限制的解）', async () => {
    fake.lastResponse = {
      requestId: 'req-1',
      actionIdentifier: 'complete',
      data: { taskId: 't1' },
    };

    const taken = await takeLastReminderResponse();

    expect(taken).toEqual({ taskId: 't1', action: 'complete', key: 'req-1|complete' });
  });

  it('读完就清掉；再读一次是 null（同一次点击不该被下一次启动再处理一遍）', async () => {
    fake.lastResponse = {
      requestId: 'req-1',
      actionIdentifier: 'snooze15',
      data: { taskId: 't1' },
    };

    expect(await takeLastReminderResponse()).not.toBeNull();
    expect(fake.clearCount).toBe(1);
    expect(await takeLastReminderResponse()).toBeNull();
  });

  it('没有过响应就是 null，且不会白清一次', async () => {
    expect(await takeLastReminderResponse()).toBeNull();
    expect(fake.clearCount).toBe(0);
  });

  it('记的是"点通知本体"也算 read 过 —— 清掉，但不产出动作', async () => {
    fake.lastResponse = {
      requestId: 'req-1',
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      data: { taskId: 't1' },
    };

    expect(await takeLastReminderResponse()).toBeNull();
    expect(fake.clearCount).toBe(1);
  });

  it('key 认得出"同一次点击、不同的按钮"是两件事', async () => {
    fake.lastResponse = { requestId: 'req-1', actionIdentifier: 'complete', data: { taskId: 't1' } };
    const first = await takeLastReminderResponse();

    fake.lastResponse = { requestId: 'req-2', actionIdentifier: 'complete', data: { taskId: 't1' } };
    const second = await takeLastReminderResponse();

    expect(first?.key).not.toBe(second?.key);
  });
});
