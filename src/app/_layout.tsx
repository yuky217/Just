import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { registerReminderActions } from '@/entry/notification-response';
import { restoreNotifyEntryIfEnabled, restoreOverlayIfEnabled } from '@/entry/overlay';
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
  const overlayEnabled = useSettings((state) => state.overlayEnabled);
  const notifyEntryEnabled = useSettings((state) => state.notifyEntryEnabled);
  const dailyReminderEnabled = useSettings((state) => state.dailyReminderEnabled);

  useEffect(() => {
    void init();
  }, [init]);

  // 用户开过悬浮球就让它自己回来，不用每次启动再去设置页点一遍 ——
  // "开一次就一直在"才是简单。没开过（false）时这里什么都不做。
  // 依赖写成具体值而不是空数组：偏好是异步 hydrate 的，
  // 挂空数组会在读到默认值 false 时就跑完，永远等不到真正的值。
  useEffect(() => {
    if (overlayEnabled) void restoreOverlayIfEnabled(true);
  }, [overlayEnabled]);

  // 通知栏入口同理（手机重启后通知被系统撤掉，打开 App 时自己回来）
  useEffect(() => {
    if (notifyEntryEnabled) void restoreNotifyEntryIfEnabled(true);
  }, [notifyEntryEnabled]);

  // 每日提醒：expo 的一次性通知在重启后可能丢，daily 触发器是系统管的，
  // 但开关状态以这里为准 —— 启动时全撤重排一次，"开着就一定挂着"
  useEffect(() => {
    void syncDailyReminder(dailyReminderEnabled);
  }, [dailyReminderEnabled]);

  return (
    // 日历的拖拽 / 翻页都走 react-native-gesture-handler，必须有一个根容器
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" />
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
