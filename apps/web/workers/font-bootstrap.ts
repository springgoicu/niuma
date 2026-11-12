/**
 * Worker 内注册渲染用字体。
 *
 * 主线程的 `@font-face` 来自 CSS，Worker 里既没有样式表也没有 `document`，
 * 所以昵称 / 状态这些 Pixi `Text` 会直接退回 `monospace` 度量——名字会比
 * 角色宽出一截。这里用 `FontFace` 把同一批 woff2 显式装进 Worker 的
 * `fonts` 集合，度量与主线程就一致了。
 *
 * 浏览器不暴露 `self.fonts` 时整段跳过：允许文字度量降级，但绝不能让入场卡住。
 */
const FACES: ReadonlyArray<{ family: string; url: string; weight: string }> = [
  { family: 'JetBrains Mono', url: '/fonts/JetBrainsMono-400.woff2', weight: '400' },
  { family: 'JetBrains Mono', url: '/fonts/JetBrainsMono-600.woff2', weight: '600' },
  // 工牌与气泡里的中文用系统字体栈；Oswald 只服务 DOM 外壳，Worker 不需要
];

export async function loadWorkerFonts(): Promise<void> {
  const fonts = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof FontFace === 'undefined') return;
  await Promise.all(
    FACES.map(async (face) => {
      try {
        const loaded = await new FontFace(face.family, `url(${face.url})`, { weight: face.weight }).load();
        fonts.add(loaded);
      } catch {
        // 单个字体失败（404 / 解码失败）只影响字宽，不阻塞入场
      }
    }),
  );
}
