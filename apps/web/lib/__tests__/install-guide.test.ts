import { describe, expect, it } from 'bun:test';
import { detectInstallPlatform, installGuide } from '../install-guide';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadDisguisedAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  windowsFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
};

describe('安装平台判定', () => {
  it('iPhone 上区分 Safari 与套壳浏览器', () => {
    expect(detectInstallPlatform(UA.iphoneSafari, { maxTouchPoints: 5 })).toBe('ios-safari');
    expect(detectInstallPlatform(UA.iphoneChrome, { maxTouchPoints: 5 })).toBe('ios-other');
  });

  it('iPadOS 伪装成 Mac 时按触点数判回 iOS', () => {
    expect(detectInstallPlatform(UA.ipadDisguisedAsMac, { maxTouchPoints: 5 })).toBe('ios-safari');
    // 同一串 UA 在真正的 Mac 上（没有触点）就是 macOS Safari
    expect(detectInstallPlatform(UA.macSafari, { maxTouchPoints: 0 })).toBe('mac-safari');
  });

  it('Android 先于 Firefox 判定，Firefox 桌面单独一档', () => {
    expect(detectInstallPlatform(UA.androidChrome)).toBe('android');
    expect(detectInstallPlatform(UA.windowsFirefox)).toBe('firefox');
  });

  it('Chromium 系桌面浏览器可一键安装', () => {
    expect(detectInstallPlatform(UA.windowsChrome)).toBe('desktop-chromium');
    expect(detectInstallPlatform(UA.windowsEdge)).toBe('desktop-chromium');
  });

  it('未知 UA 落到通用书签引导', () => {
    expect(detectInstallPlatform('curl/8.4.0')).toBe('desktop-other');
    expect(detectInstallPlatform('', {})).toBe('desktop-other');
  });
});

describe('引导文案', () => {
  const platforms = [
    'ios-safari',
    'ios-other',
    'android',
    'mac-safari',
    'firefox',
    'desktop-chromium',
    'desktop-other',
  ] as const;

  it('每档都有标题、步骤与补充说明', () => {
    for (const platform of platforms) {
      const guide = installGuide(platform);
      expect(guide.heading.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.steps.every((step) => step.length > 0)).toBe(true);
      expect(guide.shortcut.length).toBeGreaterThan(0);
    }
  });

  it('iOS 一律指向系统分享面板', () => {
    expect(installGuide('ios-safari').steps.join('')).toContain('添加到主屏幕');
    expect(installGuide('ios-other').steps.join('')).toContain('添加到主屏幕');
  });
});
