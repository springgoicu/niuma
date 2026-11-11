/**
 * 品牌标记：双帧叠图。
 *
 * 两帧同时进 DOM —— hover 只切 opacity，不产生额外请求、不闪白、不触发布局。
 * 资源由 `pnpm assets` 从 16×16 位图按 3× 导出；窄屏 32px 正好是 2 倍纹素，
 * 每个像素块仍等宽（与角色图集同一条「只取整数倍」的规矩，ADR-0005）。
 */
export function LogoMark() {
  return (
    <span aria-hidden className="relative block h-8 w-8 shrink-0 sm:h-12 sm:w-12">
      <img
        src="/brand/logo-48.png"
        alt=""
        width={48}
        height={48}
        draggable={false}
        className="pixelated absolute inset-0 h-full w-full select-none"
      />
      <img
        src="/brand/logo-48-blink.png"
        alt=""
        width={48}
        height={48}
        draggable={false}
        className="pixelated logo-blink absolute inset-0 h-full w-full select-none"
      />
    </span>
  );
}
