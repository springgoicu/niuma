import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '牛马 NIOMA — 永不下班的像素办公园区',
  description:
    '《牛马》是一座 2D 像素多人在线办公园区。选一头牛或一匹马，走进工位、打字聊天、坐下躺平。20Hz 权威同步，WebGPU 渲染，8 字节移动包。',
  icons: {
    // 同一份 16×16 位图按整数倍导出（pnpm assets），标签页在 1x/2x/3x 屏上各取所需
    icon: [
      { url: '/brand/logo-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/logo-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/logo-48.png', sizes: '48x48', type: 'image/png' },
    ],
    // iOS 主屏：180 的余量用底板色补齐，透明区域不会在系统里变成纯黑
    apple: [{ url: '/brand/logo-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#14100c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // 输入法弹起时让布局视口跟着缩：摇杆与动作盘随可视视口上移，不被键盘盖住
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 字体已自托管到 /public/fonts（拉丁子集），不再请求 Google Fonts：
            国内访问 fonts.googleapis.com 常年超时，会直接拖垮 FCP/LCP */}
        <link
          rel="preload"
          href="/fonts/Oswald-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
