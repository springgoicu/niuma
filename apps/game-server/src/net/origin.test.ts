import { describe, expect, it } from 'bun:test';
import { createOriginGuard } from './origin';

const guard = createOriginGuard('https://bangying.top,https://www.bangying.top');

describe('WS 握手 Origin 白名单', () => {
  it('放行主站与 www', () => {
    expect(guard('https://bangying.top')).toBe(true);
    expect(guard('https://www.bangying.top')).toBe(true);
  });

  it('大小写与结尾斜杠不影响判定', () => {
    expect(guard('https://BANGYING.TOP')).toBe(true);
    expect(guard('https://bangying.top/')).toBe(true);
  });

  it('挡掉别的站点（CSWSH）', () => {
    expect(guard('https://evil.example')).toBe(false);
    expect(guard('http://bangying.top')).toBe(false);
    // 子域名不在白名单里：ngrok 之类的中转域名不能被当成主站
    expect(guard('https://bangying.top.evil.example')).toBe(false);
    // 端口也算不同的 origin
    expect(guard('https://bangying.top:8443')).toBe(false);
  });

  it('空 Origin 放行：非浏览器客户端不发这个头', () => {
    expect(guard(null)).toBe(true);
    expect(guard(undefined)).toBe(true);
    expect(guard('')).toBe(true);
  });

  it('本地开发白名单：任意端口的 localhost / 127.0.0.1', () => {
    expect(guard('http://localhost:3000')).toBe(true);
    expect(guard('http://127.0.0.1:4173')).toBe(true);
    expect(guard('https://localhost')).toBe(true);
    expect(guard('http://[::1]:3000')).toBe(true);
    // 只是长得像的域名不算
    expect(guard('http://localhost.evil.example')).toBe(false);
  });

  it('配置为空时回落到主站默认值，不会变成「谁都能连」', () => {
    const fallback = createOriginGuard('');
    expect(fallback('https://bangying.top')).toBe(true);
    expect(fallback('https://evil.example')).toBe(false);
  });

  it('配置可整体替换（换域名时只改这一个环境变量）', () => {
    const custom = createOriginGuard('https://niuma.example');
    expect(custom('https://niuma.example')).toBe(true);
    expect(custom('https://bangying.top')).toBe(false);
  });
});
