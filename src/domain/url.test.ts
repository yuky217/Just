import { describe, expect, it } from 'vitest';

import { normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('没填就是没链接', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });

  it('手机上复制来的多半没有协议头：补 https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('www.qq.com/news')).toBe('https://www.qq.com/news');
    expect(normalizeUrl('mp.weixin.qq.com/s/abcd')).toBe('https://mp.weixin.qq.com/s/abcd');
  });

  it('已经带协议头的原样放行', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
  });

  it('前后空格不影响', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com');
    expect(normalizeUrl(' example.com ')).toBe('https://example.com');
  });

  it('深链也放行（自己人 aischedule:// 要能跳）', () => {
    expect(normalizeUrl('aischedule://capture')).toBe('aischedule://capture');
  });

  it('一眼不是链接的：不给他一个打不开的按钮', () => {
    expect(normalizeUrl('随便写')).toBeNull();
    expect(normalizeUrl('记得买牛奶')).toBeNull();
    expect(normalizeUrl('example')).toBeNull();
  });
});
