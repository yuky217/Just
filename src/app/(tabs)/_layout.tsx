import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useMemo } from 'react';

import { TAB_ICON } from '@/constants/tabs';
import { ALL_TAB_KEYS, TAB_LABEL, visibleTabs } from '@/domain/features';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/state/settings-store';

/**
 * 底部五个 Tab —— 就是主文档"本体层"的几个入口。
 *
 * 注意这里没有"AI"入口：AI 是能力和入口，不是界面本身，
 * 它出现在首页的记录框里、待办的整理动作里，但不需要自己占一个 Tab。
 * 也没有"纪念日"入口：它落在日历页的格子与卡片上（不提醒、不催办的东西，
 * 不该跟任务抢导航位）。
 *
 * 「首页」排在正中间：左手右手都够得着，而且它回答"现在做哪件"，
 * 本来就是五个入口里被点得最多的那个。注意 Tab 顺序**只影响显示顺序**，
 * 冷启动落在哪个页面由下面的 anchor 决定 —— 别把两件事混为一谈。
 *
 * ⭐ 2026-10-13：**顺序可自定义，功能可关**（设置页两张卡，口径全在
 * `domain/features.ts`）。其余四个 Tab 谁前谁后用户自己排；「项目」「想法」
 * 还能整个关掉（关掉 = 功能关了，入口全部消失，数据不动）。
 * **首页既不参与排序也不给关**：它是冷启动的落点，把它拖到角落等于把自己的家挪走。
 *
 * ⭐ 2026-10-13：**只留图标，不写文字**。
 * 五个图标（收件盘 / 日历 / 今天 / 相册 / 灯泡）本身已经分得开，
 * 文字只是把同一件事又说了一遍，却要占掉一整条底栏的高度 ——
 * 而底部这一条是每一页都要付的固定成本。
 * `title` 保留：路由标签与读屏还要用它，**藏的是画出来的那行字，不是这个页面的名字**。
 */

/** 冷启动仍然落在首页，不管它在 Tab 栏排第几 */
export const unstable_settings = {
  anchor: 'index',
};

export default function TabsLayout() {
  const theme = useTheme();
  const features = useSettings((state) => state.features);
  const tabOrder = useSettings((state) => state.tabOrder);

  /**
   * 顺序和"谁不出现"都由这一份口径算（`domain/features.ts`）：
   * 首页恒在中位，关掉的功能（项目 / 想法）整项不渲染。
   *
   * ⚠️ 这里是**动态 children** 而不是写死五段 JSX：写死了就只能靠
   * `href: null` 把某个 Tab 藏起来，顺序还改不了。
   */
  const shown = useMemo(() => visibleTabs(tabOrder, features), [tabOrder, features]);

  /**
   * 关掉的那几个 Tab **仍然要声明**，只是声明成 `href: null`。
   *
   * ⚠️ 这条是自测截图抓出来的坑：expo-router 会按文件名自动注册同一目录下的每个路由，
   * 所以"不声明"不等于"不存在" —— 它会自己补一个**默认样式**的 Tab 回来，
   * 底栏右边于是多出一个没图标、点进去还是关掉页面（然后被守门弹回首页）的光格子。
   * 顺序也归我们管：先把要显示的按用户排的顺序摆好，再把藏起来的补声明在末尾。
   */
  const hidden = useMemo(
    () => ALL_TAB_KEYS.filter((key) => !shown.includes(key)),
    [shown],
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 图标是这一栏唯一的内容（见文件头那段）；页名仍靠 options.title 传给路由与读屏
        tabBarShowLabel: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.backgroundSelected,
        },
      }}>
      {shown.map((key) => (
        <Tabs.Screen
          key={key}
          name={key}
          options={{
            title: TAB_LABEL[key],
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={TAB_ICON[key]} size={size} color={color} />
            ),
          }}
        />
      ))}

      {/* 关掉的功能：路由还在（守门负责拦截深链），但底栏上不给它位置 */}
      {hidden.map((key) => (
        <Tabs.Screen key={key} name={key} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
