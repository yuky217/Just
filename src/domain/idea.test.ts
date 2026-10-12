import { describe, expect, it } from 'vitest';

import { parseIdeaTags } from './idea';

describe('parseIdeaTags：从灵感文本里抽 #标签', () => {
  it('抽出标签并从正文摘除', () => {
    const { content, tags } = parseIdeaTags('内容 #工作 #灵感');
    expect(content).toBe('内容');
    expect(tags).toEqual(['工作', '灵感']);
  });

  it('中文连写整个当一个标签（中文词间无空格）', () => {
    const { content, tags } = parseIdeaTags('周会纪要 #会议纪要');
    expect(content).toBe('周会纪要');
    expect(tags).toEqual(['会议纪要']);
  });

  it('同一标签的大小写变体只留一个（大小写不敏感去重）', () => {
    const { tags } = parseIdeaTags('#Study #study #STUDY');
    expect(tags).toEqual(['Study']);
  });

  it('自动去掉标签里多余的前置 #', () => {
    const { tags } = parseIdeaTags('读书 ##精读');
    expect(tags).toEqual(['精读']);
  });

  it('没有标签时正文原样返回、tags 为空', () => {
    const { content, tags } = parseIdeaTags('  一个朴素的念头  ');
    expect(content).toBe('一个朴素的念头');
    expect(tags).toEqual([]);
  });

  it('整段只有一个标签时，正文退回原文（不存空白想法）', () => {
    const { content, tags } = parseIdeaTags('#only');
    expect(tags).toEqual(['only']);
    expect(content).toBe('#only');
  });
});
