/**
 * 功能开关与 Tab 顺序的唯一口径（2026-10-13）。
 *
 * 两件事放在同一个文件里，因为它们是同一件事的两面：**Tab 是功能的门面** ——
 * 「项目」「想法」这两个 Tab 显不显示，本来就由那两个功能开不开决定，
 * 拆成两套状态迟早会打架（一边说开、一边说关，界面该听谁的）。
 *
 * 三条铁律，改这里之前先读一遍：
 *
 * 1. **关掉功能不删数据**。所有开关都只影响"界面上有没有这条路"，
 *    库里一行都不动。重新打开，东西还在原地 —— 用户关掉的是"我不想看见它"，
 *    不是"我不要这些了"。这两件事必须分开，否则一次误触就是不可逆的。
 * 2. **关掉就要关干净**。凡是通往这个功能的入口（Tab、图标、chip、搜索分组、
 *    详情页里的那张卡、小组件）全部消失，不许留一个点了没反应或者跳进
 *    一片空白的死链 —— 死链比不做更伤：它让人以为是自己点错了。
 * 3. **代码要优雅降级**。关掉的功能不该让任何页面崩：剩下的数据照旧显示
 *    （比如关掉习惯，已有的习惯任务仍在待办里），自动分流也不许再造出
 *    看不见的东西（`decideRoute` 因此接受同一份 flags）。
 */

/** 可以被关掉的功能 */
export type FeatureKey =
  | 'habits'
  | 'marks'
  | 'projects'
  | 'review'
  | 'checkin'
  | 'ideas'
  | 'period';

/** 关不掉的功能：它们是这个 App 的骨架，界面上不给开关 */
export type AlwaysOnKey = 'home' | 'inbox' | 'calendar' | 'focus';

export type FeatureFlags = Record<FeatureKey, boolean>;

/** 设置页按这个顺序列；顺序即"从最像独立模块到最像一个动作" */
export const FEATURE_KEYS: readonly FeatureKey[] = [
  'habits',
  'marks',
  'projects',
  'review',
  'checkin',
  'ideas',
  'period',
];

/** 默认**全开**：第一次来的人还没说过"我不要这个"，替他关掉任何一项都是替他做决定 */
export const defaultFeatureFlags = (): FeatureFlags => ({
  habits: true,
  marks: true,
  projects: true,
  review: true,
  checkin: true,
  ideas: true,
  period: true,
});

/**
 * 「打卡」能不能用。
 *
 * 打卡是**习惯的动作**（把一件事在今天记一笔），不是独立功能 ——
 * 所以习惯整个关掉时它就无处可打，跟着一起消失；
 * 只关打卡则习惯还在（它仍是待办里一件要做的事），只是不再记"今天做没做"。
 * 这个"与"关系只写这一处，界面上任何打卡入口都来问它。
 */
export const isCheckinOn = (flags: FeatureFlags): boolean => flags.checkin && flags.habits;

/** 设置页上的名字 */
export const FEATURE_LABEL: Record<FeatureKey, string> = {
  habits: '习惯',
  marks: '纪念日',
  projects: '项目 / 目标',
  review: '回顾',
  checkin: '打卡',
  ideas: '想法库',
  period: '经期',
};

/**
 * 设置页上那行小字：说清**关掉会少什么**，而不是说这个功能是什么。
 *
 * 用户在这儿要决定的是"我舍不舍得它"，不是"它是什么" ——
 * 后者他在别处早就看见了。所以每条都写"会消失的东西"，不写介绍。
 */
export const FEATURE_HINT: Record<FeatureKey, string> = {
  habits: '关掉后：习惯页、首页那一行、任务类型里的「习惯」都不出现',
  marks: '关掉后：日历里的纪念日圆点、「快到的日子」都不出现',
  projects: '关掉后：项目 Tab、记录时的「项目」chip 都不出现',
  review: '关掉后：首页右上角那颗回顾不再出现',
  checkin: '关掉后：打卡按钮、热力图、回顾里的打卡次数都不出现（习惯还在）',
  ideas: '关掉后：想法 Tab、记录时的「这是灵感」都不出现',
  period: '关掉后：首页预测卡、日历里的经期圆点、提前提醒都不出现（已记的数据保留）',
};

/* ------------------------------------------------------------------ */
/* Tab                                                                  */
/* ------------------------------------------------------------------ */

/** 能参与排序的 Tab（首页不在里面，见下） */
export type SortableTabKey = 'inbox' | 'calendar' | 'projects' | 'ideas';

/** 底栏上出现的全部 Tab */
export type TabKey = SortableTabKey | 'index';

/** 默认顺序 = 现在的顺序：手边（待办/日历）在左，攒的东西（项目/想法）在右 */
export const SORTABLE_TABS: readonly SortableTabKey[] = ['inbox', 'calendar', 'projects', 'ideas'];

/**
 * 底栏总共**可能有**哪几个路由（含被关掉的）。
 *
 * ⚠️ 关掉的那几个必须由 `(tabs)/_layout.tsx` **显式声明成 `href: null`**，
 * 不能只是"不声明"：expo-router 会按文件名自动注册同级的每个路由，漏声明不等于
 * 不存在 —— 它会自己补一个**默认样式**的 Tab 回来（没图标、顺序还挂在队尾）。
 * 这个坑是自测截图时抓到的：关掉「想法」之后，底栏右边多出一个光秃秃的格子。
 */
export const ALL_TAB_KEYS: readonly TabKey[] = [...SORTABLE_TABS, 'index'];

export const TAB_LABEL: Record<TabKey, string> = {
  inbox: '待办',
  calendar: '日历',
  index: '首页',
  projects: '项目',
  ideas: '想法',
};

/**
 * 这个 Tab 归哪个功能管 —— 关掉那个功能，它就不在底栏出现。
 * `null` = 这个功能关不掉（待办 / 日历），所以这两个 Tab 也永远在。
 */
export const TAB_FEATURE: Record<SortableTabKey, FeatureKey | null> = {
  inbox: null,
  calendar: null,
  projects: 'projects',
  ideas: 'ideas',
};

/**
 * 首页插在第几个 Tab 之后 —— **按当前剩下的 Tab 数居中**，而不是写死一个位置。
 *
 * 写死会出事：五个 Tab 时"第 2 个之后"是正中间，可一旦关掉「想法」剩四个，
 * 同一个位置就把首页挤到偏右；再关一个它干脆落到最末 ——
 * "首页在中位"这条承诺是随着 Tab 数变的，位置也得跟着变。
 *
 * 首页**不参与排序**这件事本身不变：它是冷启动落点（`unstable_settings.anchor`）、
 * 是"现在做哪件"的答案，也是被点得最多的那个 —— 让人把它拖到角落，
 * 等于把自己的家挪走。所以顺序只影响**其余几个 Tab 的先后**。
 */
const homeSlotOf = (sortableCount: number): number => Math.ceil(sortableCount / 2);

export const defaultTabOrder = (): SortableTabKey[] => [...SORTABLE_TABS];

/**
 * 容错：顺序是从持久化里读的，旧存档可能缺项、也可能有已经不存在的键。
 * 缺的补在后面，多的丢掉 —— 宁可用默认顺序，也不能渲染出一个空底栏。
 */
export function normalizeTabOrder(order: readonly SortableTabKey[] | null | undefined): SortableTabKey[] {
  const kept: SortableTabKey[] = [];
  for (const key of order ?? []) {
    if (SORTABLE_TABS.includes(key) && !kept.includes(key)) kept.push(key);
  }
  for (const key of SORTABLE_TABS) {
    if (!kept.includes(key)) kept.push(key);
  }
  return kept;
}

/** 这个 Tab 现在该不该出现在底栏 */
export function isTabVisible(key: TabKey, flags: FeatureFlags): boolean {
  if (key === 'index') return true;
  const feature = TAB_FEATURE[key];
  return !feature || flags[feature];
}

/**
 * 底栏真正要画的顺序：其余 Tab 按用户排的先后，首页插在固定位置。
 *
 * 关掉的功能不出现在结果里 —— 这是"关掉就要关干净"在导航层的落点。
 */
export function visibleTabs(
  order: readonly SortableTabKey[] | null | undefined,
  flags: FeatureFlags,
): TabKey[] {
  const kept = normalizeTabOrder(order).filter((key) => isTabVisible(key, flags));
  const slot = homeSlotOf(kept.length);
  return [...kept.slice(0, slot), 'index', ...kept.slice(slot)];
}

/**
 * 排序用的完整列表（含被关掉的 Tab）。
 *
 * 设置页要用它 —— 关掉的项必须还能看见，否则用户关了就再也开不回来
 * （列表里没有它，开关也就跟着消失了）。
 */
export function tabOrderWithHome(
  order: readonly SortableTabKey[] | null | undefined,
): TabKey[] {
  const kept = normalizeTabOrder(order);
  const slot = homeSlotOf(kept.length);
  return [...kept.slice(0, slot), 'index', ...kept.slice(slot)];
}

/* ------------------------------------------------------------------ */
/* 深链守门                                                             */
/* ------------------------------------------------------------------ */

/**
 * 路由段 → 它归哪个功能管。
 *
 * 关掉的功能，它的**页面本身**也得进不去 —— 光把 Tab 藏了不够：
 * 通知、小组件、旧的深链、还有"关掉之前最后一次浏览的位置"都会在重启后
 * 把人直接送进那间已经关灯的屋子。所以路由层要再守一道。
 */
export const ROUTE_SEGMENT_FEATURE: Record<string, FeatureKey> = {
  habits: 'habits',
  marks: 'marks',
  review: 'review',
  container: 'projects',
  projects: 'projects',
  idea: 'ideas',
  ideas: 'ideas',
};

/**
 * 这条路由归哪个可关功能管。`null` = 谁也不归（首页 / 待办 / 日历 / 专注 /
 * 设置 / 任务详情……它们本来就不给关，什么时候都能进）。
 *
 * 传进来的应当只是**当前聚焦的那一段链**（`useSegments()`）——
 * 设置面板是浮在上层的另一条链，不该因为下面压着一个已关的 Tab 就把人弹走。
 */
export function featureForSegments(segments: readonly string[]): FeatureKey | null {
  for (const segment of segments) {
    const feature = ROUTE_SEGMENT_FEATURE[segment];
    if (feature) return feature;
  }
  return null;
}

/**
 * 守门的判定：这条路由现在**进不去**的话，返回把它关掉的那个功能。
 * `null` = 可以进。
 */
export function blockedRouteFeature(
  segments: readonly string[] | null | undefined,
  flags: FeatureFlags,
): FeatureKey | null {
  const feature = featureForSegments(segments ?? []);
  if (!feature || flags[feature]) return null;
  return feature;
}
