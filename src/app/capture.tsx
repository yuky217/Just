import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { isOcrReady, recognizeImage } from '@/capabilities/ocr';
import { CaptureSuccess } from '@/components/capture-success';
import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { type DateTimePreset } from '@/components/date-time-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CaptureSource } from '@/domain/enums';
import type { CaptureRoute } from '@/domain/routing';
import type { QuickCaptureResult } from '@/entry/quick-capture';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { closeScreen } from '@/utils/navigation';

/**
 * 快速记录（模态）。
 *
 * 界面上只有输入框 + 一排 chip —— 以前"什么时候"预设单占一张卡，说的事和
 * "时间"chip 是同一件（2026-10-07 并入）：预设挪进了时间面板顶部，点一下
 * 即定即收；不点就是不定时间（或者交给文本自动识别）。
 * 它仍然不问"这件事属于哪个项目"——那是待办和后面的流程该干的事。
 *
 * 记完**不换页**：大勾动效 1.6 秒自动关页（2026-10-08 用户点名撤掉结果卡 ——
 * 那页只为说一声"成了"，还要用户再按一次关是纯负担）。× 用 closeScreen：
 * 直接开网址 / 深链冷启动时没有历史栈，back() 是空操作。
 *
 * ⭐ **三个入口共用这一页**（2026-10-13）：
 * - 应用内「＋」：什么都不带；
 * - 通知栏弹窗：`text` + `auto=1`（拿到就提交，这一页只落库 + 给回执）；
 * - **系统分享**：文字走 `text`（弹窗里已预填，这儿照旧 auto=1），
 *   图片走 `image`（本地文件路径）—— 先 OCR 成文字，**再**让它进输入框。
 *   识别出的文字**不自动提交**：OCR 会把排版、落款一起认出来，
 *   直接记下去等于替用户决定"这一段就是标题"。给它看一眼的机会。
 */

const CAPTURE_TIME_PRESETS: readonly DateTimePreset[] = [
  {
    key: 'today-evening',
    label: '今天 18:00',
    build: () => draftAt(0, 18 * 60, 'fixed'),
  },
  {
    key: 'tomorrow-morning',
    label: '明天 09:00',
    build: () => draftAt(1, 9 * 60, 'fixed'),
  },
  {
    key: 'tomorrow-due',
    label: '明天 18:00 截止',
    build: () => draftAt(1, 18 * 60, 'deadline'),
  },
];

function draftAt(dayOffset: number, minutesOfDay: number, attribute: 'fixed' | 'deadline') {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return { date, minutesOfDay, attribute };
}

const ROUTE_LABEL: Record<CaptureRoute, string> = {
  idea: '想法库',
  inbox: '待办',
  calendar: '日历',
};

export default function CaptureScreen() {
  const router = useRouter();
  const theme = useTheme();
  const capture = useAppStore((state) => state.capture);
  // 待办入口带 from=inbox 进来：用户是从「待办」那一栏点进来的，他要记的就是一件事，
  // 再摆一个"这是灵感"的勾选是自相矛盾的入口（想记灵感的人会去想法页，那儿整条为它而生）。
  // text/auto 来自通知栏弹窗的深链（原生侧 CaptureDialogActivity 拼的）：
  // auto=1 = 拿到就提交，这一页只落库 + 给回执，不再问一遍。
  const { from, text: presetText, auto, image, src } = useLocalSearchParams<{
    from?: string;
    text?: string;
    auto?: string;
    image?: string;
    src?: string;
  }>();
  const showIdeaToggle = from !== 'inbox';

  const [result, setResult] = useState<QuickCaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ocr = useSettings((state) => state.ocr);

  /*
   * 图片分享进来：先把图认成字。
   *
   * ⚠️ 输入框**等识别完才渲染**，而不是先渲染再把文字塞进去 ——
   * `initialText` 只在挂载那一刻读一次，异步回来的文字塞不进一个已经活着的输入框。
   * 等的过程只有一两秒，显示"正在认这张图"也比给一个空框让人对着空气打字强。
   */
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);

  const imagePath = typeof image === 'string' && image.length > 0 ? image : null;
  useEffect(() => {
    if (!imagePath) return;
    if (!isOcrReady(ocr)) {
      setError('这张图认不出字：还没填 OCR 接口（设置 → 截图 OCR）。字可以自己打，图就先不认了。');
      return;
    }
    let alive = true;
    setRecognizing(true);
    void recognizeImage(imagePath, ocr).then((res) => {
      if (!alive) return;
      setRecognizing(false);
      if (res.ok) {
        setOcrText(res.text);
      } else {
        setError(`这张图没认出来：${res.reason}。字可以自己打。`);
      }
    });
    return () => {
      alive = false;
    };
  }, [imagePath, ocr]);

  /** 这条记录是从哪儿来的：写进 source，日后能分清"手打的 / 分享的 / 截图的" */
  const sourceFromEntry =
    src === 'share'
      ? CaptureSource.Share
      : src === 'screenshot'
        ? CaptureSource.Screenshot
        : undefined;

  /** 动效播完 / 点了一下 → 关页。closeScreen 兜底无历史栈的情况 */
  const finish = useCallback(() => closeScreen(router), [router]);

  return (
    <Screen
      title="记一件事"
      subtitle="时间可以先空着，之后再安排"
      scroll
      right={
        <Pressable hitSlop={8} onPress={() => closeScreen(router)}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {result ? (
        <CaptureSuccess
          label={`已归入${ROUTE_LABEL[result.route]}`}
          title={result.title}
          hint={result.reminderScheduled ? '到点会提醒你' : undefined}
          onDone={finish}
        />
      ) : recognizing ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            正在认这张图…
          </ThemedText>
        </Card>
      ) : (
        <>
          <CaptureInput
            autoFocus
            initialText={
              (typeof presetText === 'string' ? presetText : undefined) ?? ocrText ?? undefined
            }
            autoSubmit={auto === '1'}
            timePresets={CAPTURE_TIME_PRESETS}
            submitLabel="记下"
            showIdeaToggle={showIdeaToggle}
            placeholder="比如：周五下午三点开会 / 想做一个只记灵感的 App"
            onSubmit={async (text, options) => {
              setError(null);
              try {
                const captured = await capture({
                  text,
                  markedAsInspiration: options.asIdea,
                  // 输入条快捷按钮（项目/重复/提醒）和 AI 解析结果全部透传，
                  // 落库口径收口在 quickCapture 一处；想法不需要这些，传了也不会用
                  time: options.time,
                  containerId: options.containerId,
                  repeat: options.repeat,
                  reminderMinutesBefore: options.reminderMinutesBefore,
                  parsed: options.parsed,
                  // 语音 > 分享来源 > 手打：语音是用户当场选的"我是说出来的"，
                  // 分享来源是这条记录被送进来的那条路，两者都在就说得最具体的那个
                  source: options.voiceUsed ? CaptureSource.Voice : sourceFromEntry,
                });
                setResult(captured);
              } catch (err) {
                setError(err instanceof Error ? err.message : '记录失败');
              }
            }}
            onVoiceError={setError}
          />

          {error ? (
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
