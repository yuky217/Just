import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * 语音输入（2026-10-13）—— 新建事项的"说"入口。
 *
 * 为什么不并进 `overlay.ts`：那边管"在系统层面占一块地方"（通知栏、浮条），
 * 这边管"把声音变成文字"，是两种不相干的能力。混在一起，
 * "拿不到原生模块时到底缺的是哪样"就说不清了。
 *
 * 三条纪律，与入口层其它封装一致：
 * ① **默认不用**。麦克风按钮只在 `isSpeechAvailable()` 为真时出现 ——
 *    一台没有识别组件的设备上，摆一个必然失败的按钮比没有更坏。
 * ② **降级不抛**。拿不到原生模块（网页 / Expo Go / iOS）时所有函数安全返回，
 *    不拖垮页面。
 * ③ **取消不是错误**。用户开了识别界面又反悔，`describeSpeechError` 返回空串，
 *    界面什么都不显示。
 */

/** 原生模块暴露的接口，与 `modules/speech` 里的 ModuleDefinition 一一对应 */
type SpeechNativeModule = {
  isAvailable: () => boolean;
  recognize: (prompt?: string) => Promise<string>;
};

let cached: SpeechNativeModule | null | undefined;

/** 拿原生模块。找不到就返回 null —— 不抛。 */
function native(): SpeechNativeModule | null {
  if (Platform.OS !== 'android') return null;
  if (cached !== undefined) return cached;
  try {
    cached = requireOptionalNativeModule<SpeechNativeModule>('Speech') ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * 这台设备有没有可用的系统语音识别。
 * 判断依据是原生侧 `queryIntentActivities` —— 真装了 recognizer 才算有，
 * 不靠"这是 Android"猜。
 */
export function isSpeechAvailable(): boolean {
  const mod = native();
  if (!mod) return false;
  try {
    return mod.isAvailable();
  } catch {
    return false;
  }
}

/** 语音没成功的几种原因。取消时 message 是空串 —— 界面见到空串就别打扰用户 */
export function describeSpeechError(err: unknown): string {
  const code = (err as { code?: string } | null | undefined)?.code;
  if (code === 'E_SPEECH_CANCELLED') return '';
  if (code === 'E_SPEECH_UNAVAILABLE') return '这台设备没有可用的语音识别';
  if (code === 'E_SPEECH_BUSY') return '上一次语音识别还没结束，稍等一下';
  return '语音输入没成功，再试一次或直接打字';
}

/**
 * 弹系统语音识别，把说的话变成文字。
 *
 * @param prompt 识别界面上的一句话提示（系统 UI 显示，可省）
 * @returns 识别出的文字。用户取消 → reject（code = E_SPEECH_CANCELLED）
 */
export async function recognizeSpeech(prompt?: string): Promise<string> {
  const mod = native();
  if (!mod) {
    const err = new Error('语音输入只有 Android 独立版有') as Error & { code: string };
    err.code = 'E_SPEECH_UNAVAILABLE';
    throw err;
  }
  return mod.recognize(prompt);
}
