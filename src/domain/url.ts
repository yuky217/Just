/**
 * 链接口径：用户粘进来的一串字，到底能不能交给系统浏览器打开。
 *
 * 手机上没有人会老老实实补全 `https://` —— 复制地址栏时拿到的是 `www.qq.com/news`，
 * 转发消息里拿到的是 `mp.weixin.qq.com/s/...`。所以"能不能打开"不能靠用户记得写协议头，
 * 得在落库/打开前收口成一条**能直接交给 Linking.openURL 的字符串**。
 *
 * 唯一口径就这一个函数：界面只问"有没有链接"，不问"这串字合不合法"。
 */

/** 已经是 `scheme:...` 形态（http/https，或者 aischedule:// 这类深链） */
const SCHEME_RE = /^[a-z][a-z0-9+.\-]*:/i;

/**
 * 裸着的一串字要配得上"域名"才算链接：至少有个点 + 两字母以上的尾巴。
 *
 * 不认 `随便写` 是刻意的 —— 那多半是用户把一句话粘进了链接框，
 * 给他一个打不开的「打开」按钮，比不给更糟。
 */
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

/**
 * 把用户填的链接收口成能直接打开的形式，不行就返回 null。
 *
 * - 空 → null（等于没填，界面上不显示「打开」）
 * - 已经带协议头 → 原样返回（http/https 之外的深链也放行，Linking 认得）
 * - 没带协议头 → 补 `https://`，但先确认它长得像域名
 *
 * 只做"补齐 + 排除明显不是链接的"，不做校验：真正的通不通只有浏览器知道。
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  if (SCHEME_RE.test(text)) return text;
  if (!BARE_HOST_RE.test(text)) return null;
  return `https://${text}`;
}
