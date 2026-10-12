import type { BaseEntity } from './base';
import type { CaptureSource } from './enums';

/**
 * 想法 / 灵感（主文档第四节的两档分流之一，软的那一档）。
 *
 * 想法不提醒、不催办，只要求"记下来不丢"，
 * 之后再靠语义检索（能力层）把它捞出来。
 */
export interface Idea extends BaseEntity {
  content: string;
  tags: string[];
  source: CaptureSource;
  /** 归档时间：不删除，只是从主列表移走 */
  archivedAt?: string | null;
  /**
   * 已经被拆成任务时，指向那条父任务。
   *
   * 记在想法这一侧（而不是在任务上留 ideaId）：想法是**来源**，它只需要知道
   * "我说出去的话有没有人接"，不需要反过来遍历谁引用过它。
   * 步数不存这里 —— 那是子任务表的实时事实，存一份就会跟实际对不上。
   */
  breakdownTaskId?: string | null;
}

/**
 * 从一段"记灵感"的文本里抽出 `#标签`。
 *
 * 标签 = `#` 后跟一串非空白、非 `#` 的字符。中文词之间没有空格，所以连写
 * 的 `#会议纪要` 整个当一个标签（按空格切反而会把整句并成一个，更怪）。
 *
 * 抽出来的标签会从正文里摘掉（标签已经是结构化字段，留在正文里只会重复），
 * 正文去掉标签后压一遍空白。只用于**想法创建**：任务另有自己的标签语义，
 * 不在这一层处理。
 *
 * 归一化：去首尾空白、去掉前置的 `#`、按"小写"去重（同一个标签打两次只留一个）。
 */
export interface ParsedIdeaText {
  /** 摘掉标签后的正文（已 trim） */
  content: string;
  /** 抽出来的标签（不含 `#`，已去重） */
  tags: string[];
}

const ideaTagPattern = (): RegExp => /#([^\s#]+)/g;

export function parseIdeaTags(text: string): ParsedIdeaText {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ideaTagPattern())) {
    const raw = match[1].trim();
    if (!raw) continue;
    const tag = raw.replace(/^#+/, '');
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  // 摘掉标签后若正文空了（整段就一个 #标签），退回原文，避免存出一条空白想法
  const stripped = text.replace(ideaTagPattern(), '').replace(/\s{2,}/g, ' ').trim();
  const content = stripped || text.trim();
  return { content, tags };
}
