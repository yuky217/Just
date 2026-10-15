import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { blockedRouteFeature } from '@/domain/features';
import { useSettings } from '@/state/settings-store';

/**
 * 深链守门：当前页面所属的功能被关掉了，就退回首页（2026-10-13）。
 *
 * 为什么非得有这一道 —— 设置页里把 Tab 藏掉只管住了"自己点进去"这一条路；
 * 通知、桌面小组件、分享、还有"上次退在哪个页面"都会直接把人送进一个
 * 已经关掉的功能。那种页面最难受：它还在，但里面所有东西都指向别处。
 *
 * 退到**首页**而不是上一页：打开 App 就落在关掉的页面上，往后退一格
 * 常常还是空的（上一页往往就是它自己），不如回到一定会有的地方。
 *
 * ⚠️ 只看当前聚焦的那条链：设置面板是浮在 Tab 之上的另一条路由，
 * 用户在里面关掉「项目」时底下压着项目页 —— 这时候不该把设置面板一起弹掉，
 * 人家还要接着调别的。等他退出设置、焦点回到项目页，下一次判定自然生效。
 */
export function useFeatureRouteGuard(): void {
  const router = useRouter();
  const segments = useSegments();
  const features = useSettings((state) => state.features);

  /**
   * 依赖用拼好的字符串而不是数组本身：`useSegments()` 每次渲染给的是新数组，
   * 直接放进依赖会让这个 effect 每帧都跑一遍。
   */
  const path = segments.join('/');
  const blocked = blockedRouteFeature(segments, features);

  useEffect(() => {
    if (blocked) router.replace('/');
  }, [blocked, path, router]);
}
