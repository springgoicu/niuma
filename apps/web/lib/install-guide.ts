/**
 * 「存到桌面」的分平台引导：纯函数，不碰 DOM，便于单测。
 *
 * 只有 Chromium 系会把可安装性信号（`beforeinstallprompt`）交给页面；
 * Safari / Firefox 只能由用户手动添加，所以文案必须按系统和浏览器分开。
 *
 * 两个已知坑都在 `detectInstallPlatform` 里处理：
 * - iPadOS 13 起默认伪装成 macOS（`Macintosh` UA + 多点触控），只按 UA 会把 iPad 判成 Mac；
 * - iOS 上所有浏览器都是 WebKit，Chrome / Firefox 也只是换了个壳，
 *   分享入口位置不同但步骤一致，所以只区分「Safari」与「其它」。
 */

export type InstallPlatform =
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'mac-safari'
  | 'firefox'
  | 'desktop-chromium'
  | 'desktop-other';

export interface InstallGuide {
  heading: string;
  steps: string[];
  /** 一条补充说明：装完之后是什么样，或找不到入口时怎么办 */
  shortcut: string;
}

/** UA 判定；`maxTouchPoints` 用来识别伪装成 Mac 的 iPad */
export function detectInstallPlatform(
  ua: string,
  hints: { maxTouchPoints?: number } = {},
): InstallPlatform {
  const touchPoints = hints.maxTouchPoints ?? 0;
  const macLike = /Macintosh|Mac OS X/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (macLike && touchPoints > 1);

  if (isIOS) {
    const isSafari = /Safari\//.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua);
    return isSafari ? 'ios-safari' : 'ios-other';
  }

  if (/Android/i.test(ua)) return 'android';
  if (/Firefox\//i.test(ua)) return 'firefox';

  // Mac 上先排掉 Chrome / Edge / Opera：它们的 UA 同样带 Safari 字样
  if (macLike && /Safari\//.test(ua) && !/(Chrome|Chromium|Edg\/|OPR\/)/i.test(ua)) {
    return 'mac-safari';
  }

  if (/Chrome\/|Chromium\/|Edg\//i.test(ua)) return 'desktop-chromium';

  return 'desktop-other';
}

const GUIDES: Record<InstallPlatform, InstallGuide> = {
  'ios-safari': {
    heading: '加到 iPhone / iPad 主屏',
    steps: [
      '点浏览器底部的「分享」按钮',
      '在弹起的面板里选「添加到主屏幕」',
      '确认右上角的「添加」',
    ],
    shortcut: '主屏会多一个牛马图标，点开是独立窗口，没有地址栏。',
  },
  'ios-other': {
    heading: '加到 iPhone / iPad 主屏',
    steps: ['点浏览器里的「分享」入口（通常在菜单中）', '选「添加到主屏幕」', '确认「添加」'],
    shortcut: '列表里没有这一项时，用系统自带的 Safari 打开本页再来一次。',
  },
  android: {
    heading: '加到 Android 主屏',
    steps: ['点浏览器右上角的「⋮」菜单', '选「添加到主屏幕」或「安装应用」', '确认「添加」'],
    shortcut: '桌面会多一个牛马图标，打开就是全屏园区。',
  },
  'mac-safari': {
    heading: '放进程序坞或书签',
    steps: ['菜单栏「文件」→「添加到程序坞…」', '或按 ⌘D 存成书签'],
    shortcut: '程序坞里的牛马是一个独立窗口，和浏览器分开。',
  },
  firefox: {
    heading: '固定到任务栏或存书签',
    steps: ['按 Ctrl+D（Mac 为 ⌘D）存成书签', '或把地址栏左侧的网站图标拖到书签栏'],
    shortcut: 'Windows 也可以在系统菜单里把窗口「固定到任务栏」。',
  },
  'desktop-chromium': {
    heading: '装到桌面',
    steps: [
      '点地址栏右侧的「安装」图标',
      '或打开右上角「⋮」→「保存并分享」→「安装页面为应用」',
      '在确认框里点「安装」',
    ],
    shortcut: '菜单里写的是「创建快捷方式」时效果一样，也会出现在桌面。',
  },
  'desktop-other': {
    heading: '存成书签',
    steps: ['按 Ctrl+D（Mac 为 ⌘D）存成书签', '或把地址直接拖到书签栏 / 桌面'],
    shortcut: '这个浏览器不支持一键装成应用，书签是等价的入口。',
  },
};

export function installGuide(platform: InstallPlatform): InstallGuide {
  return GUIDES[platform];
}
