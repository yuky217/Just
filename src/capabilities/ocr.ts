import { EncodingType, readAsStringAsync } from 'expo-file-system';

/**
 * 截图 OCR：把一张图变成一段能记的文字（2026-10-13）。
 *
 * 为什么是**云端**而不是本地：手机是鸿蒙 Mate 70 Pro，**没有 Google 服务**，
 * ML Kit 那条路直接不成立；本地塞一个中文 ONNX 模型进安装包是 +20MB 起步，
 * 还要自己写推理。云端换来的代价只有两条 —— 要联网、图片要传出去，
 * 所以它是**默认关**的：不填接口就一次网都不上（见 `isOcrReady`）。
 *
 * ⚠️ 隐私边界要写在界面上，不能藏在这儿：识别意味着**这张图会离开手机**。
 * 设置页那张卡里因此写了清楚的一句话，并且"不填 = 不识别"这个默认
 * 让"介意的人"什么都不用做就已经被保护了 —— 保护不该是一次配置项里的二选一。
 *
 * 选百度通用文字识别（general_basic）：中文识别准确率够、有免费额度、
 * 接口就是一次 POST，不需要签名算法（腾讯那套 v3 签名要自己算 HMAC）。
 */

export interface OcrConfig {
  apiKey: string;
  secretKey: string;
}

export const emptyOcrConfig = (): OcrConfig => ({ apiKey: '', secretKey: '' });

/**
 * 配好了才算开。
 *
 * 两个 key 都要：access_token 是用它们换的，缺一个连请求都发不出去。
 * **空 = 关**，不是一个布尔开关 —— 少一个开关就少一处"开了却不能用"的状态。
 */
export function isOcrReady(config: OcrConfig | null | undefined): boolean {
  return !!config && config.apiKey.trim() !== '' && config.secretKey.trim() !== '';
}

export type OcrResult =
  | { ok: true; text: string }
  /** reason 直接给用户看：他要据此决定"是填错了还是网络不行" */
  | { ok: false; reason: string };

/** access_token 缓存：一个月有效期，没必要每识别一张图都换一次 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchToken(config: OcrConfig): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  try {
    const res = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials` +
        `&client_id=${encodeURIComponent(config.apiKey.trim())}` +
        `&client_secret=${encodeURIComponent(config.secretKey.trim())}`,
      { method: 'POST' },
    );
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    // 提前 5 分钟过期，别卡在临界点上失败
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 2592000) - 300) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

/**
 * 识别一张本地图片。
 *
 * @param uri 本地文件路径（`file://` 开头，分享进来那张已经由原生复制到缓存里了）
 */
export async function recognizeImage(uri: string, config: OcrConfig): Promise<OcrResult> {
  if (!isOcrReady(config)) return { ok: false, reason: '还没填 OCR 接口' };

  /*
   * 原生那边给的是绝对路径（cacheDir 下的那个文件），expo-file-system 认 `file://`，
   * 所以这里补一下前缀 —— 补重复了（已经是 file:// 开头）就原样用。
   */
  const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
  let base64: string;
  try {
    base64 = await readAsStringAsync(fileUri, { encoding: EncodingType.Base64 });
  } catch {
    return { ok: false, reason: '这张图读不出来' };
  }
  if (!base64) return { ok: false, reason: '这张图是空的' };

  const token = await fetchToken(config);
  if (!token) return { ok: false, reason: '接口没认这个 key（去设置里核一下）' };

  try {
    const res = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `image=${encodeURIComponent(base64)}`,
      },
    );
    const json = (await res.json()) as {
      words_result?: { words?: string }[];
      error_msg?: string;
    };
    if (json.error_msg) return { ok: false, reason: json.error_msg };
    const lines = (json.words_result ?? [])
      .map((row) => row.words ?? '')
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) return { ok: false, reason: '这张图里没认出字' };
    /*
     * 用换行拼起来：OCR 给的是一行行结果，而这正是记录框最想要的形态 ——
     * 后面的 `parseSchedule` / 标题提炼本来就按"第一行是名字"来处理
     * （粘一整段通知进来走的是同一条路）。别在这里自作聪明地合并成一段。
     */
    return { ok: true, text: lines.join('\n') };
  } catch {
    return { ok: false, reason: '识别没发出去（看看网络）' };
  }
}
