import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LEXICON,
  createModerationFilter,
  inspectText,
  isAdLikeNickname,
  normalizeWithMap,
} from '..';

/**
 * 用一套假词表验证引擎行为：词条本身没有意义，
 * 真正要锁死的是「夹字/全角/叠字/替代能不能绕过」与「打码区间准不准」。
 */
const filter = createModerationFilter({
  political: ['测试红线词'],
  profanity: ['测试脏话', 'shit', 'fuck', 'ass'],
});

describe('规范化', () => {
  it('去噪后仍能映射回原文字符位置', () => {
    const normalized = normalizeWithMap('傻 逼');
    expect(normalized.value).toBe('傻逼');
    expect(normalized.start).toEqual([0, 2]);
    expect(normalized.end).toEqual([1, 3]);
  });

  it('全角压半角、小写化', () => {
    expect(normalizeWithMap('ＳＨＩＴ').value).toBe('shit');
  });

  it('叠字折叠：中文从第 2 个起折，拉丁从第 3 个起折', () => {
    expect(normalizeWithMap('测测试试').value).toBe('测试');
    expect(normalizeWithMap('ass').value).toBe('ass');
    expect(normalizeWithMap('fuuuck').value).toBe('fuck');
  });

  it('数字谐音替换成对应字母', () => {
    expect(normalizeWithMap('sh1t').value).toBe('shit');
  });
});

describe('裁决', () => {
  it('干净文本原样放行', () => {
    const result = filter.inspect('今天也在加班');
    expect(result).toMatchObject({ verdict: 'allow', category: null, hits: 0 });
    expect(result.text).toBe('今天也在加班');
  });

  it('政治类命中整条拒绝，文本原样返回给调用方决定怎么提示', () => {
    const result = filter.inspect('这里有测试红线词');
    expect(result).toMatchObject({ verdict: 'reject', category: 'political', hits: 1 });
    expect(result.text).toBe('这里有测试红线词');
  });

  it('同时命中两类时按政治类裁决', () => {
    expect(filter.inspect('测试红线词和测试脏话').verdict).toBe('reject');
  });

  it('脏话命中原位打码，长度不变', () => {
    const text = '你这测试脏话';
    const result = filter.inspect(text);
    expect(result).toMatchObject({ verdict: 'mask', category: 'profanity', hits: 1 });
    expect(result.text).toBe('你这****');
    // 打码只换字符不删字符：气泡与消息列表的排版不会跳动
    expect(Array.from(result.text)).toHaveLength(Array.from(text).length);
  });

  it('打码后的文本再过一遍是干净的', () => {
    const masked = filter.inspect('你这测试脏话').text;
    expect(filter.inspect(masked).verdict).toBe('allow');
  });

  it('空串与纯标点直接放行', () => {
    expect(filter.inspect('').verdict).toBe('allow');
    expect(filter.inspect('···——').verdict).toBe('allow');
  });
});

describe('绕过手法', () => {
  it('夹空格、标点、零宽字符都能识别', () => {
    for (const text of [
      '测 试 红 线 词',
      '测.试*红-线_词',
      '测\u200b试\u200d红\ufeff线词',
      '测🐮试🔥红线词',
    ]) {
      expect(filter.inspect(text).verdict).toBe('reject');
    }
  });

  it('全角与大小写混写', () => {
    expect(filter.inspect('ＳＨＩＴ').text).toBe('****');
    expect(filter.inspect('ShIt').text).toBe('****');
  });

  it('叠字绕过', () => {
    expect(filter.inspect('测测试试脏脏话话').text).toBe('********');
  });

  it('数字替字绕过', () => {
    expect(filter.inspect('sh1t').text).toBe('****');
  });

  it('拉丁重复字母折叠不会把正常短词折成敏感词', () => {
    // ass 在词表里，但不能因此误伤 as
    expect(filter.inspect('as').verdict).toBe('allow');
    expect(filter.inspect('ass').text).toBe('***');
  });
});

describe('内置词库', () => {
  it('政治类只放占位条目，命中即拒绝', () => {
    expect(BUILTIN_LEXICON.political.length).toBeGreaterThan(0);
    expect(inspectText('示例敏感词甲')).toMatchObject({ verdict: 'reject', category: 'political' });
  });

  it('脏话打码，未命中的部分保持原样', () => {
    expect(inspectText('你真是个傻逼').text).toBe('你真是个**');
  });

  it('统计口径是实际参与匹配的去重词条数', () => {
    const counted = createModerationFilter({ political: ['a', 'a', ''], profanity: ['bb'] });
    expect(counted.counts).toEqual({ political: 1, profanity: 1 });
  });
});

/**
 * 广告形态：这条走原文正则而不是词库，因为 normalize 会剔掉 `.` 与 `@`，
 * `.com` 在匹配前就只剩 `com`——写进词表会把 `welcome` 一起打码。
 */
describe('昵称形态', () => {
  it('拦下域名、协议头、邮箱与社交号', () => {
    for (const name of ['www.51cgf15.com', '51cgf15.com', 'https://x.cn', 'a@b.com', 'qq123456']) {
      expect(isAdLikeNickname(name), name).toBe(true);
    }
  });

  it('不误伤正常昵称', () => {
    for (const name of ['设计狗', 'momo', 'robin', '1', 'very粉', 'version1.0', '26届美工牛博']) {
      expect(isAdLikeNickname(name), name).toBe(false);
    }
  });

  it('内置词库能识别常见低俗词', () => {
    expect(inspectText('巨乳').verdict).toBe('mask');
    expect(inspectText('操翻地球').verdict).toBe('mask');
  });
});
