import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FlipClock } from '@/components/flip-clock';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatDateLong } from '@/utils/datetime';

/**
 * 自习室 —— 一个安静的钟（2026-10-15）。
 *
 * 它**刻意什么都不做**：不记时长、不绑任务、不进回顾、没有开始也没有结束。
 *
 * 为什么还要有这一页：专注页是"这一场要干多久"，它天然带着目标和结算；
 * 但很多时候人只是想让桌上有块钟 —— 抬头看一眼几点，然后继续。
 * 那种时候给一个计时器反而是一种负担：它要你开始、要你结束、要你命名。
 *
 * 所以这里的取舍是：
 *   · **只翻到分钟**。秒针每秒动一次就不是"安静"了，那是在提醒人时间在走。
 *   · **不留任何按钮、不留任何说明**。进来就是看着，退出走系统返回手势。
 *   · **常亮**。手机往桌上一放是给它当钟用的，几十秒就熄屏等于没有。
 *   · **横过来更好看**。钟横过来才像"桌上的钟"，所以这一页临时解锁横屏，
 *     离开锁回去 —— 别的页面没为横屏做过布局，不该被这一页的选择连累。
 *
 * 尺寸不用这一页操心：`FlipClock` 自己按宽和高两个方向取小值缩放，
 * 竖着横着都落在中间，不会顶边。
 */
export default function StudyRoomScreen() {
  const [now, setNow] = useState(() => new Date());
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  /** 挂在这一页期间屏幕不熄；离开自动解除（hook 自己管） */
  useKeepAwake();

  /**
   * 整 app 在 `app.json` 里锁的是竖屏，这里进页面放开、离开锁回去。
   *
   * `ALL` 在安卓上落到 `FullSensor` —— 跟着传感器转，横竖都由手机说了算，
   * 而不是硬把人按进横屏（这页没有"必须横着看"的理由）。
   * 离开时锁回 `PORTRAIT_UP`，跟 `app.json` 的声明对上。
   *
   * 网页端没有这个能力（`lockAsync` 会直接抛 UnavailabilityError），
   * 所以只在原生端调 —— 不然一次导出的预览会整页崩掉。
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL);
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  /**
   * 只在整分钟翻一次，而不是每秒 setState。
   *
   * 先算"离下一个整分钟还有多久"再睡到那一刻 —— 直接 setInterval(1000)
   * 会跟系统秒产生漂移，翻的那一刻可能慢半拍。
   * 后台回来（AppState）也要补一次：那段时间定时器是被挂起的，回来就是旧时间。
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const tick = new Date();
      const delay = 60_000 - (tick.getSeconds() * 1000 + tick.getMilliseconds()) + 60;
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };

    const sync = () => {
      setNow(new Date());
      schedule();
    };

    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <Screen scroll={false} contentStyle={styles.content}>
      <View style={styles.center}>
        <FlipClock value={hhmm} />
        {/*
          横屏时钟放大到 2.4 倍，日期还停在 small 那一档会显得像掉在旁边的一粒灰，
          所以跟着换到 default（16px）。竖屏不变。
        */}
        <ThemedText type={landscape ? 'default' : 'small'} themeColor="textSecondary">
          {formatDateLong(now)}
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /**
   * 整页居中：钟是这一页唯一的内容，不该偏在一边。
   *
   * `paddingTop: 0` 是把外壳留给页头的 16px 让回去 —— 这页没有页头，
   * 留着它整组会往下偏 8px（实测：竖屏 8px、横屏一致）。
   */
  content: { justifyContent: 'center', paddingTop: 0 },
  center: { alignItems: 'center', gap: Spacing.four },
});
