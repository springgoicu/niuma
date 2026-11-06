import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '牛马 NIOMA — 永不下班的像素办公园区',
  description:
    '《牛马》是一座 2D 像素多人在线办公园区。选一头牛或一匹马，走进工位、打字聊天、坐下躺平。20Hz 权威同步，WebGPU 渲染，8 字节移动包。',
};

export const viewport: Viewport = {
  themeColor: '#14100c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
