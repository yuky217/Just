import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useFeatureRouteGuard } from '@/hooks/use-feature-route-guard';
import { registerReminderActions } from '@/entry/notification-response';
import { restoreNotifyEntryIfEnabled } from '@/entry/overlay';
import { syncDailyReminder } from '@/entry/notifications';
import '@/widget';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';

SplashScreen.preventAutoHideAsync();

// 提醒通知上的按钮（完成 / 稍后）在任何页面之外被点，注册必须跟着
// 模块加载就走 —— 等某个页面挂载就晚了。内部自幂等，重复调是空操作。
registerReminderActions();

/**
 * 根布局。
 *
 * 职责只有三件：套上主题、把本地数据库拉起来、给手势库一个根容器。
 * 页面本身一律 headerShown: false，自己画自己的页头（见 components/screen.tsx），
 * 免得原生导航栏和自绘页头两套视觉打架。
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const init = useAppStore((state) => state.init);
  const notifyEntryEnabled = useSettings((state) => state.notifyEntryEnabled);
  const dailyReminderEnabled = useSettings((state) => state.dailyReminderEnabled);

  useEffect(() => {
    void init();
  }, [init]);

  /*
   * 偏好是**异步 hydrate** 的（AsyncStorage）。hydrate 完成前读到的永远是默认值 ——
   * 直接拿它驱动"恢复"类动作会出事：通知栏入口默认开，若用户当初手动关过，
   * 启动时先用默认值 true 跑一遍恢复，通知就亮出来了，等 hydrate 出 false 已经晚了一步。
   * 所以这些 effect 一律等 hydrate 完成再跑。
   */
  const [hydrated, setHydrated] = useState(() => useSettings.persist.hasHydrated());
  useEffect(() => useSettings.persist.onFinishHydration(() => setHydrated(true)), []);

  // 通知栏入口：手机重启后通知被系统撤掉，打开 App 时自己回来 ——
  // "开一次就一直在"才是简单。没开过（false）时这里什么都不做。
  useEffect(() => {
    if (!hydrated) return;
    if (notifyEntryEnabled) void restoreNotifyEntryIfEnabled(true);
  }, [hydrated, notifyEntryEnabled]);

  // 每日提醒：expo 的一次性通知在重启后可能丢，daily 触发器是系统管的，
  // 但开关状态以这里为准 —— 启动时全撤重排一次，"开着就一定挂着"
  useEffect(() => {
    if (!hydrated) return;
    void syncDailyReminder(dailyReminderEnabled);
  }, [hydrated, dailyReminderEnabled]);

  /*
   * 功能开关的路由守门（2026-10-13）。
   * 关掉的功能，它的页面连深链也不许进 —— 通知 / 小组件 / 上次退出时的位置
   * 都可能直接把人送进去，那种"还在但空了"的页面比没有更糟。
   * 判定口径全在 `hooks/use-feature-route-guard.ts`。
   */
  useFeatureRouteGuard();

  return (
    // 日历的拖拽 / 翻页都走 react-native-gesture-handler，必须有一个根容器
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" />
          {/* 原生提醒「完成」按钮的深链落点：不给人看，落库完自己走 */}
          <Stack.Screen name="reminder-action" />
          <Stack.Screen name="course/[id]" />
          <Stack.Screen name="container/[id]" />
          <Stack.Screen name="marks" />
          <Stack.Screen name="habits" />
          <Stack.Screen name="review" />
          <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
          <Stack.Screen name="focus" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="import-courses" options={{ presentation: 'modal' }} />
          <Stack.Screen name="import-exams" options={{ presentation: 'modal' }} />
          <Stack.Screen name="add-course" options={{ presentation: 'modal' }} />
          <Stack.Screen name="term-settings" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
