import { describe, expect, it } from 'bun:test';
import { GHOST_MODE, POSE, WORLD_HOTSPOTS } from '@niuma/shared-types';
import { actionPresentation, resolveInteraction, type InteractionState } from '../actions';
import { buildClipTracks, buildGtaTracks, gtaTrackFor } from '../clip';
import { HINT, hintButton, touchHint } from '../hint-copy';
import { ACTION_BY_CODE, ACTION_CODE } from '../input';
import { hintForHotspot } from '../interactions';
import { ghostAlpha, ghostLiftTexels } from '../pony-motion';
import { KEY_BIT } from '../runtime/control-channel';

const BASE_STATE: InteractionState = {
  pose: POSE.Walk,
  seated: false,
  seatKind: null,
  moving: true,
  seatAvailable: false,
  bedAvailable: false,
};

const GTA_HOTSPOT_KINDS = [
  'clinicCoffee',
  'changingBooth',
  'payphone',
  'estateBoard',
  'fishingPier',
  'graffitiWall',
  'loadingDock',
  'securityGarage',
  'bossVault',
] as const;

describe('GTA 客户端动作轨与表现辅助函数', () => {
  it('buildGtaTracks 构建 7 条非空 GTA 动作轨并按摔倒 > 濒死/幽灵 > 驾驶 > CPR 优先级选择', () => {
    const tracks = buildClipTracks();
    const gta = buildGtaTracks(tracks);

    expect(gta.slip).not.toBeNull();
    expect(gta.tumble).not.toBeNull();
    expect(gta.tornado).not.toBeNull();
    expect(gta.flatline).not.toBeNull();
    expect(gta.ghost).not.toBeNull();
    expect(gta.drive).not.toBeNull();
    expect(gta.cpr).not.toBeNull();

    // fall 优先级最高（1=slip, 2=tumble, 3=tornado）
    expect(gtaTrackFor(gta, 1, GHOST_MODE.Ghost, true, true)).toBe(gta.slip);
    expect(gtaTrackFor(gta, 2, GHOST_MODE.Flatline, true, true)).toBe(gta.tumble);
    expect(gtaTrackFor(gta, 3, GHOST_MODE.Alive, false, false)).toBe(gta.tornado);

    // 其次 ghostMode（1=flatline, 2=ghost）
    expect(gtaTrackFor(gta, 0, GHOST_MODE.Flatline, true, true)).toBe(gta.flatline);
    expect(gtaTrackFor(gta, 0, GHOST_MODE.Ghost, true, true)).toBe(gta.ghost);

    // 其次驾驶 > CPR > 普通姿态
    expect(gtaTrackFor(gta, 0, GHOST_MODE.Alive, true, true)).toBe(gta.drive);
    expect(gtaTrackFor(gta, 0, GHOST_MODE.Alive, false, true)).toBe(gta.cpr);
    expect(gtaTrackFor(gta, 0, GHOST_MODE.Alive, false, false)).toBeNull();
  });

  it('ghostAlpha 与 ghostLiftTexels 仅在幽灵形态生效且高度保持整数纹素', () => {
    expect(ghostAlpha(GHOST_MODE.Alive, 500)).toBe(1);
    expect(ghostAlpha(GHOST_MODE.Flatline, 500)).toBe(1);
    expect(ghostLiftTexels(GHOST_MODE.Alive, 500)).toBe(0);
    expect(ghostLiftTexels(GHOST_MODE.Flatline, 500)).toBe(0);

    for (const t of [0, 320, 640, 960, 1280]) {
      const alpha = ghostAlpha(GHOST_MODE.Ghost, t);
      const lift = ghostLiftTexels(GHOST_MODE.Ghost, t);
      expect(alpha).toBeGreaterThanOrEqual(0.34 - 1e-6);
      expect(alpha).toBeLessThanOrEqual(0.62 + 1e-6);
      expect([-2, -3]).toContain(lift);
      expect(Number.isInteger(lift)).toBe(true);
    }
  });
});

describe('GTA 键盘码、控制位与互动解析', () => {
  it('vehicle/cpr/gig 占用动作码 7/8/9 且 KEY_BIT.sprint 独立于四向位移位', () => {
    expect(ACTION_CODE.vehicle).toBe(7);
    expect(ACTION_CODE.cpr).toBe(8);
    expect(ACTION_CODE.gig).toBe(9);
    expect(ACTION_BY_CODE[7]).toBe('vehicle');
    expect(ACTION_BY_CODE[8]).toBe('cpr');
    expect(ACTION_BY_CODE[9]).toBe('gig');

    expect(KEY_BIT.sprint).toBe(1 << 4);
    expect(KEY_BIT.sprint & (KEY_BIT.up | KEY_BIT.down | KEY_BIT.left | KEY_BIT.right)).toBe(0);
  });

  it('GTA 动作在行走中依然可触发且按钮呈正常可用态', () => {
    expect(resolveInteraction('vehicle', BASE_STATE)).toEqual({ kind: 'vehicle' });
    expect(resolveInteraction('cpr', BASE_STATE)).toEqual({ kind: 'cpr' });
    expect(resolveInteraction('gig', BASE_STATE)).toEqual({ kind: 'gig' });

    for (const action of ['vehicle', 'cpr', 'gig'] as const) {
      expect(actionPresentation(action, BASE_STATE)).toEqual({ active: false, unavailable: false });
    }
  });

  it('9 类 GTA 热点均在共享热点表中，且提示文案同时支持 F 键按钮与触屏「互动」引导', () => {
    for (const kind of GTA_HOTSPOT_KINDS) {
      const hotspot = WORLD_HOTSPOTS.find((h) => h.kind === kind);
      expect(hotspot).toBeDefined();
      const hint = hintForHotspot(hotspot!);
      expect(hint).toBe(HINT[kind]);
      const button = hintButton(hint);
      expect(button?.action).toBe('interact');
      expect(button?.key).toBe('F');
      expect(touchHint(hint)).toContain('「互动」');
    }
  });
});
