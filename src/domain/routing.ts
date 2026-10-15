import { TimeAttribute } from './enums';
import type { TaskKind } from './enums';
import type { FeatureFlags } from './features';
import type { TaskTime } from './task';

/**
 * 两档分流（主文档第四节）。
 *
 * 这是整个产品的"记 → 分"环节，也是最该被单测覆盖的一段：
 * 纯函数、没有 IO、没有 UI，输入一段记录 + 解析出的时间，输出它该去哪儿。
 */

export type CaptureRoute = 'idea' | 'calendar' | 'inbox';

export interface CaptureDraft {
  text: string;
  /** 解析出的时间。来源可以是能力层（AI）解析，也可以是用户手动点选 */
  time?: TaskTime | null;
  /** 用户在记录当下就明确"这是灵感" */
  markedAsInspiration?: boolean;
}

export interface RouteDecision {
  route: CaptureRoute;
  /** 建议的任务类型 */
  kind: TaskKind;
  /** 为什么这么分 —— 界面可以直接展示给用户，让他一眼看懂 */
  reason: string;
}

/**
 * @param flags 功能开关。**关掉的功能不会被"自动分流"送进去** ——
 *   想法库关了还把"我有个想法"判成想法，用户就会记完找不到（它落在一个
 *   看不见的格子里）。宁可落成一条普通待办，也不能造出看不见的东西。
 */
export function decideRoute(draft: CaptureDraft, flags?: FeatureFlags): RouteDecision {
  // 想法库关了：这一格没有"家"，勾了灵感也照样进待办（界面上那个勾也已经不出现，
  // 这里是给深链 / 语音这些没有界面的入口兜底）
  if (draft.markedAsInspiration && (flags?.ideas ?? true)) {
    return { route: 'idea', kind: 'idea', reason: '标记为灵感 → 想法库' };
  }

  const time = draft.time;
  if (!time || time.attribute === TimeAttribute.None) {
    return {
      route: 'inbox',
      kind: inferKind(draft.text, flags),
      reason: '没有明确时间 → 待办（等你安排）',
    };
  }

  if (time.attribute === TimeAttribute.Fixed) {
    return { route: 'calendar', kind: 'schedule', reason: '有固定时间 → 日历' };
  }

  return { route: 'calendar', kind: 'execution', reason: '有明确截止 → 日历' };
}

/**
 * 没有时间信息时的兜底分类。
 *
 * 骨架阶段用最朴素的启发式，够用就行；
 * 真正的"理解"是能力层的事（主文档 3.1），能力关闭时这段启发式就是降级方案。
 */
function inferKind(text: string, flags?: FeatureFlags): TaskKind {
  const t = text.trim();
  if (!t) return 'execution';
  // 习惯关了就不再判成习惯：造出一条"习惯"用户却看不见（习惯页、首页那行都没了），
  // 它只会静静地躺在待办里，带着一个解释不通的类型
  if (flags?.habits ?? true) {
    if (/(每周|每天|每月|每日|隔天|每周\d次|习惯)/.test(t)) return 'habit';
    if (/(跑步|健身|背单词|阅读|冥想|练琴|打卡|喝\d*杯水)/.test(t)) return 'habit';
  }
  if ((flags?.ideas ?? true) && /(灵感|想法|点子|也许|要不要|考虑)/.test(t)) return 'idea';
  return 'execution';
}
