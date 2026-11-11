/**
 * 园区公告 / 微信交流群配置。
 *
 * 换群只改这里的 `qrUrl`：前端不直接引这张图，而是走同源的 `/api/community/qr`
 * ——线上站点是 https，直连 http 图床会被浏览器当成混合内容拦掉，
 * 那条路由还会顺手把 70KB 的截图重新编码成 9KB 的调色板 PNG。
 *
 * 源图是微信生成的群二维码，7 天过期；过期后把新图传到同一个存储、换上新直链即可。
 * MinIO 的下载端点只接受 GET（HEAD 会回 405），排查时别拿 HEAD 当探活。
 */
export const COMMUNITY = {
  wechat: {
    title: '加入牛马园微信群',
    subtitle: '扫码进群：找搭子、反馈问题、等放号通知，都在里面喊。',
    qrUrl:
      'http://8.130.22.109:9001/api/v1/buckets/niuma/objects/download?preview=true&prefix=Snipaste_2026-11-11_15-14-14.jpg&version_id=null',
    alt: '牛马园微信交流群二维码',
    hint: '微信扫一扫 · 长按识别二维码',
    expiry: '群二维码 7 天内有效，过期请在群里找管理员补发。',
    footer: '#niuma · 交流群',
  },
} as const;
