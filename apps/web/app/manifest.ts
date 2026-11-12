import type { MetadataRoute } from 'next';

/**
 * PWA 安装清单：园区右上角「存到桌面」靠它让浏览器认为本站可安装。
 *
 * `start_url` 取 `/` 而不是 `/play`：首页在解析阶段就会按 `niuma:park:v1`
 * 跳到玩家上次选的园区（ADR-0038）。写死 `/play` 会让多园区部署里的桌面
 * 图标永远落回第一座园区。
 *
 * 只声明 `standalone`，不锁横竖屏：园区在手机上是竖屏也能玩的。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '牛马 NIOMA — 永不下班的像素办公园区',
    short_name: '牛马',
    description:
      '一座 2D 像素多人在线办公园区。选一头牛或一匹马，走进工位、打字聊天、坐下躺平。',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'zh-CN',
    dir: 'ltr',
    background_color: '#14100c',
    theme_color: '#14100c',
    icons: [
      { src: '/brand/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/logo-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
