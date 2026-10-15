import { describe, expect, it } from 'vitest';

import {
  blockedRouteFeature,
  defaultFeatureFlags,
  featureForSegments,
  FEATURE_KEYS,
  isCheckinOn,
  isTabVisible,
  normalizeTabOrder,
  tabOrderWithHome,
  visibleTabs,
  type FeatureFlags,
} from './features';

/** 全开 —— 默认状态 */
const ALL_ON = defaultFeatureFlags();

const off = (...keys: (keyof FeatureFlags)[]): FeatureFlags => {
  const flags = defaultFeatureFlags();
  for (const key of keys) flags[key] = false;
  return flags;
};

describe('功能开关', () => {
  it('默认全开 —— 没说过不要，就是还要', () => {
    for (const value of Object.values(ALL_ON)) expect(value).toBe(true);
  });

  /**
   * 验牙：打卡是"习惯的动作"。若这里改成只看 flags.checkin，
   * 关掉习惯（打卡仍开）时打卡入口就会留在一个不存在的页面上 —— 测试应变红。
   */
  it('关掉习惯，打卡跟着一起消失（打卡是习惯的动作，不是独立功能）', () => {
    expect(isCheckinOn(ALL_ON)).toBe(true);
    expect(isCheckinOn(off('checkin'))).toBe(false);
    expect(isCheckinOn(off('habits'))).toBe(false);
  });

  it('关掉打卡，习惯还在（它仍是一件要做的事，只是不再记今天）', () => {
    expect(off('checkin').habits).toBe(true);
  });
});

describe('Tab 顺序', () => {
  it('默认顺序：手边的在左，攒的在右；首页固定在中位', () => {
    expect(tabOrderWithHome(null)).toEqual(['inbox', 'calendar', 'index', 'projects', 'ideas']);
  });

  it('顺序是持久化的，缺项补末尾、多的丢掉 —— 不能画出一个空底栏', () => {
    expect(normalizeTabOrder(['ideas'])).toEqual(['ideas', 'inbox', 'calendar', 'projects']);
    expect(normalizeTabOrder(['inbox', 'inbox', 'calendar'])).toEqual([
      'inbox',
      'calendar',
      'projects',
      'ideas',
    ]);
    // 'index' 不参与排序，混进来也要丢掉
    expect(normalizeTabOrder(['index' as never, 'ideas'])).toEqual([
      'ideas',
      'inbox',
      'calendar',
      'projects',
    ]);
  });

  it('把想法拖到最前：首页的位置不动（它不参与排序）', () => {
    expect(tabOrderWithHome(['ideas', 'inbox', 'calendar', 'projects'])).toEqual([
      'ideas',
      'inbox',
      'index',
      'calendar',
      'projects',
    ]);
  });

  it('首页永远在，关不掉也挪不走', () => {
    expect(isTabVisible('index', ALL_ON)).toBe(true);
    expect(isTabVisible('index', off('habits', 'projects', 'ideas'))).toBe(true);
  });

  it('关掉的功能，它的 Tab 从底栏消失；待办 / 日历关不掉', () => {
    const shown = visibleTabs(['ideas', 'inbox', 'calendar', 'projects'], off('ideas'));
    expect(shown).toEqual(['inbox', 'calendar', 'index', 'projects']);
    expect(visibleTabs(null, off('projects', 'ideas'))).toEqual(['inbox', 'index', 'calendar']);
  });

  /**
   * 首页的位置**跟着剩下的 Tab 数居中**，不是写死的第几位：
   * 五个 Tab 时"第 2 个之后"是正中，剩三个时同一个位置就把它挤到偏右、
   * 剩两个时直接顶到最末 —— "首页在中位"这条承诺得随着 Tab 数一起变。
   */
  it('全关到底：底栏还剩三个，首页仍在正中（待办 / 首页 / 日历）', () => {
    const shown = visibleTabs(null, off('habits', 'marks', 'projects', 'review', 'checkin', 'ideas'));
    expect(shown).toEqual(['inbox', 'index', 'calendar']);
  });
});

describe('深链守门', () => {
  it('关掉的功能，它的页面连深链也不许进', () => {
    expect(featureForSegments(['habits'])).toBe('habits');
    expect(featureForSegments(['(tabs)', 'ideas'])).toBe('ideas');
    expect(featureForSegments(['container', 'abc'])).toBe('projects');
    expect(featureForSegments(['idea', 'xyz'])).toBe('ideas');

    expect(blockedRouteFeature(['habits'], off('habits'))).toBe('habits');
    expect(blockedRouteFeature(['(tabs)', 'projects'], off('projects'))).toBe('projects');
  });

  it('开着的、以及关不掉的功能，随便进', () => {
    expect(blockedRouteFeature(['habits'], ALL_ON)).toBeNull();
    // 首页 / 待办 / 日历 / 专注 / 设置不归任何可关功能管
    expect(blockedRouteFeature(['(tabs)', 'index'], off('habits', 'projects', 'ideas'))).toBeNull();
    expect(blockedRouteFeature(['(tabs)', 'calendar'], off('habits', 'projects', 'ideas'))).toBeNull();
    expect(blockedRouteFeature(['settings'], off('projects'))).toBeNull();
    expect(blockedRouteFeature(null, off('projects'))).toBeNull();
  });

  /**
   * 验牙：设置面板浮在 Tab 之上，是**另一条**聚焦链。
   * 若守门改成遍历全部打开的路由，用户在设置里关掉「项目」的瞬间就会被弹走 ——
   * 那等于不让人连着调两下。这里给的正是"设置"这条链，必须放行。
   */
  it('在设置里关掉某个功能，不会被当场弹走', () => {
    expect(blockedRouteFeature(['settings'], off('projects', 'ideas'))).toBeNull();
  });
});

describe('经期功能', () => {
  it('经期是可关功能，且不在底栏（它没有 Tab）', () => {
    expect(FEATURE_KEYS).toContain('period');
    // 关掉经期不影响底栏：底栏只由 SortableTabKey 决定
    const shown = visibleTabs(null, off('period'));
    expect(shown).toEqual(['inbox', 'calendar', 'index', 'projects', 'ideas']);
  });
});
