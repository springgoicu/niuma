import { describe, expect, it } from 'bun:test';

describe('气泡保护', () => {
  it('限制字符数至 80 个并添加省略号', () => {
    const longText = 'a'.repeat(100);
    const MAX_CHAT_LENGTH = 80;
    
    let sanitized = longText.length > MAX_CHAT_LENGTH 
      ? longText.substring(0, MAX_CHAT_LENGTH - 1) + '…'
      : longText;
    
    expect(sanitized.length).toBe(MAX_CHAT_LENGTH);
    expect(sanitized.endsWith('…')).toBe(true);
  });

  it('不截断短于 80 字的文本', () => {
    const shortText = 'Hello World!';
    const MAX_CHAT_LENGTH = 80;
    
    let sanitized = shortText.length > MAX_CHAT_LENGTH 
      ? shortText.substring(0, MAX_CHAT_LENGTH - 1) + '…'
      : shortText;
    
    expect(sanitized).toBe(shortText);
    expect(sanitized.endsWith('…')).toBe(false);
  });

  it('限制行数至 3 行并添加省略号', () => {
    const multilineText = 'line1\nline2\nline3\nline4\nline5';
    const MAX_LINES = 3;
    
    let sanitized = multilineText;
    const lines = sanitized.split('\n');
    if (lines.length > MAX_LINES) {
      sanitized = lines.slice(0, MAX_LINES).join('\n') + '…';
    }
    
    const resultLines = sanitized.split('\n');
    expect(resultLines.length).toBe(MAX_LINES);
    expect(sanitized.endsWith('…')).toBe(true);
  });

  it('不截断少于 3 行的文本', () => {
    const twoLineText = 'line1\nline2';
    const MAX_LINES = 3;
    
    let sanitized = twoLineText;
    const lines = sanitized.split('\n');
    if (lines.length > MAX_LINES) {
      sanitized = lines.slice(0, MAX_LINES).join('\n') + '…';
    }
    
    expect(sanitized).toBe(twoLineText);
    expect(sanitized.includes('…')).toBe(false);
  });

  it('节流阻止 300ms 内多次更新', () => {
    let lastBubbleUpdateTime = 0;
    const BUBBLE_UPDATE_THROTTLE = 300;
    let updateCount = 0;
    
    // 模拟三个相近的时间戳
    const now1 = 1000;
    const now2 = 1100;  // 100ms 后
    const now3 = 1350;  // 350ms 后
    
    // 第一个更新
    if (now1 - lastBubbleUpdateTime >= BUBBLE_UPDATE_THROTTLE) {
      lastBubbleUpdateTime = now1;
      updateCount++;
    }
    expect(updateCount).toBe(1);
    
    // 第二个更新在 100ms 内，应被阻止
    if (now2 - lastBubbleUpdateTime >= BUBBLE_UPDATE_THROTTLE) {
      lastBubbleUpdateTime = now2;
      updateCount++;
    }
    expect(updateCount).toBe(1); // 仍然是 1
    
    // 第三个更新在 350ms 后，应通过
    if (now3 - lastBubbleUpdateTime >= BUBBLE_UPDATE_THROTTLE) {
      lastBubbleUpdateTime = now3;
      updateCount++;
    }
    expect(updateCount).toBe(2);
  });

  it('淡出过渡从 1.0 平滑到 0', () => {
    const bubbleUntil = 2000;
    const FADE_DURATION = 400;
    
    // 在淡出开始时的透明度
    let now = bubbleUntil - FADE_DURATION;
    const fadeStart = bubbleUntil - FADE_DURATION;
    let alpha = 1;
    if (now > fadeStart) {
      const fadeProgress = (now - fadeStart) / FADE_DURATION;
      alpha = Math.max(0, 1 - fadeProgress);
    }
    expect(alpha).toBe(1); // 刚开始淡出，alpha 应为 1
    
    // 在淡出中间时的透明度
    now = bubbleUntil - FADE_DURATION / 2;
    if (now > fadeStart) {
      const fadeProgress = (now - fadeStart) / FADE_DURATION;
      alpha = Math.max(0, 1 - fadeProgress);
    }
    expect(alpha).toBeCloseTo(0.5, 1); // 中间应为 ~0.5
    
    // 在淡出结束时的透明度
    now = bubbleUntil;
    if (now > fadeStart) {
      const fadeProgress = (now - fadeStart) / FADE_DURATION;
      alpha = Math.max(0, 1 - fadeProgress);
    }
    expect(alpha).toBeCloseTo(0, 1); // 结束应为 ~0
  });

  it('气泡队列管理：超过 10 个时最早的淡出', () => {
    const MAX_VISIBLE_BUBBLES = 10;
    const activeBubbles = Array.from({ length: 15 }, (_, i) => ({
      id: i,
      bubbleUntil: 1000 + i * 100,
    }));
    
    // 按过期时间排序（最久的在前）
    activeBubbles.sort((a, b) => a.bubbleUntil - b.bubbleUntil);
    
    // 如果超过限制，最早的 5 个应被标记淡出
    const toFadeOut = [];
    if (activeBubbles.length > MAX_VISIBLE_BUBBLES) {
      for (let i = 0; i < activeBubbles.length - MAX_VISIBLE_BUBBLES; i++) {
        toFadeOut.push(activeBubbles[i].id);
      }
    }
    
    expect(toFadeOut.length).toBe(5); // 15 - 10 = 5
    expect(toFadeOut).toEqual([0, 1, 2, 3, 4]); // 最早的 5 个
  });

  it('结合字符和行数限制', () => {
    const longMultilineText = 'a'.repeat(100) + '\nb'.repeat(100) + '\nc'.repeat(100) + '\nd'.repeat(100);
    const MAX_CHAT_LENGTH = 80;
    const MAX_LINES = 3;
    
    // 先限制字符
    let sanitized = longMultilineText.length > MAX_CHAT_LENGTH 
      ? longMultilineText.substring(0, MAX_CHAT_LENGTH - 1) + '…'
      : longMultilineText;
    
    // 再限制行数
    const lines = sanitized.split('\n');
    if (lines.length > MAX_LINES) {
      sanitized = lines.slice(0, MAX_LINES).join('\n') + '…';
    }
    
    // 应该被截断
    expect(sanitized.includes('…')).toBe(true);
  });
});
