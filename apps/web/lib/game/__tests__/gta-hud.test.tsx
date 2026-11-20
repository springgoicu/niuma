import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FISHING_STATE,
  GHOST_MODE,
  GIG_KIND,
  GIG_STATE,
  VILLA_SPECS,
  VILLA_THEME,
  type VillaStatePacket,
} from '@niuma/shared-types';
import { ActionBar } from '../../../components/game/ActionBar';
import { EstateBoardDialog } from '../../../components/game/EstateBoardDialog';
import { GigAndStatusHUD } from '../../../components/game/GigAndStatusHUD';
import { VillaDialog } from '../../../components/game/VillaDialog';
import { WantedStarsHUD } from '../../../components/game/WantedStarsHUD';
import { useGameUi } from '@/lib/game-ui';

vi.mock('@/lib/game-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game-ui')>();
  const bound = ((selector?: (state: ReturnType<typeof actual.useGameUi.getState>) => unknown) => {
    const state = actual.useGameUi.getState();
    return selector ? selector(state) : state;
  }) as typeof actual.useGameUi;
  Object.assign(bound, actual.useGameUi);
  return { ...actual, useGameUi: bound };
});

afterEach(() => {
  useGameUi.getState().reset();
});

describe('GTA HUD 组件渲染', () => {
  it('WantedStarsHUD 在 0★ 隐藏，1★~5★ 按热度显示赏金与追捕警告', () => {
    expect(
      renderToStaticMarkup(
        <WantedStarsHUD onClearStar={() => {}} onNavigateBooth={() => {}} onNavigatePayphone={() => {}} />,
      ),
    ).toBe('');

    useGameUi.getState().setWanted({ id: 1, stars: 2, bounty: 80, clearCdSec: 0 });
    const twoStarHtml = renderToStaticMarkup(
      <WantedStarsHUD onClearStar={() => {}} onNavigateBooth={() => {}} onNavigatePayphone={() => {}} />,
    );
    expect(twoStarHtml).toContain('通缉 2 星');
    expect(twoStarHtml).toContain('赏金 ¥80');
    expect(twoStarHtml).toContain('去换装亭');
    expect(twoStarHtml).toContain('去公用电话');
    expect(twoStarHtml).toContain('当场自首');

    useGameUi.getState().setWanted({ id: 1, stars: 4, bounty: 220, clearCdSec: 0 });
    expect(
      renderToStaticMarkup(
        <WantedStarsHUD onClearStar={() => {}} onNavigateBooth={() => {}} onNavigatePayphone={() => {}} />,
      ),
    ).toContain('HR 机械杜宾犬');

    useGameUi.getState().setWanted({ id: 1, stars: 5, bounty: 500, clearCdSec: 0 });
    expect(
      renderToStaticMarkup(
        <WantedStarsHUD onClearStar={() => {}} onNavigateBooth={() => {}} onNavigatePayphone={() => {}} />,
      ),
    ).toContain('老板黄金压路机');
  });

  it('GigAndStatusHUD 渲染倒地待救、灵魂穿墙、钓鱼咬钩与进行中零工卡片', () => {
    expect(
      renderToStaticMarkup(<GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />),
    ).toBe('');

    useGameUi.getState().setGhost({ id: 1, mode: GHOST_MODE.Flatline, cprProgress: 45, leftMs: 12000 });
    const flatlineHtml = renderToStaticMarkup(
      <GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />,
    );
    expect(flatlineHtml).toContain('街头倒地待救 · CPR 45%');
    expect(flatlineHtml).toContain('[H] 灵魂出窍');

    useGameUi.getState().setGhost({ id: 1, mode: GHOST_MODE.Ghost, cprProgress: 0, leftMs: 18000 });
    const ghostHtml = renderToStaticMarkup(
      <GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />,
    );
    expect(ghostHtml).toContain('灵魂出窍 · 可自由穿墙游荡');
    expect(ghostHtml).not.toContain('[H] 灵魂出窍');

    useGameUi.getState().setFishing({ id: 1, state: FISHING_STATE.Waiting, spotId: 1, biteAtMs: 3000, rewardKind: 0 });
    expect(
      renderToStaticMarkup(<GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />),
    ).toContain('摸鱼抛竿中（栈桥 #2）');

    useGameUi.getState().setFishing({ id: 1, state: FISHING_STATE.Biting, spotId: 0, biteAtMs: 0, rewardKind: 1 });
    const bitingHtml = renderToStaticMarkup(
      <GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />,
    );
    expect(bitingHtml).toContain('鱼咬钩了');
    expect(bitingHtml).toContain('提竿');

    useGameUi.getState().setGig({
      kind: GIG_KIND.Delivery,
      state: GIG_STATE.Active,
      targetX: 4160,
      targetY: 3860,
      reward: 65,
      timeLeftSec: 90,
      targetId: 0,
    });
    const gigHtml = renderToStaticMarkup(
      <GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />,
    );
    expect(gigHtml).toContain('零工 · 外卖极速跑腿');
    expect(gigHtml).toContain('+¥65');
    expect(gigHtml).toContain('4160, 3860');

    useGameUi.getState().setGig({
      kind: GIG_KIND.PatrolAssist,
      state: GIG_STATE.Active,
      targetX: 5320,
      targetY: 4316,
      reward: 85,
      timeLeftSec: 60,
      targetId: 2,
    });
    const patrolHtml = renderToStaticMarkup(
      <GigAndStatusHUD onFishing={() => {}} onGig={() => {}} onCprSelf={() => {}} />,
    );
    expect(patrolHtml).toContain('零工 · 协助巡逻抓捕');
    expect(patrolHtml).toContain('+¥85');
    expect(patrolHtml).toContain('5320, 4316');
  });

  it('EstateBoardDialog 展示 8 处房产总览与业主冠名宣言', () => {
    const packet: VillaStatePacket = {
      villas: [
        {
          id: 0,
          ownerId: 99,
          ownerName: '包租婆牛马',
          locked: false,
          owned: true,
          mine: false,
          pending: 0,
          theme: VILLA_THEME.CyberNeon,
          tagline: '日进斗金',
        },
      ],
    };

    expect(
      renderToStaticMarkup(
        <EstateBoardDialog
          open={false}
          villas={packet}
          onClose={() => {}}
          onInspectVilla={() => {}}
          onNavigateVilla={() => {}}
        />,
      ),
    ).toBe('');

    const html = renderToStaticMarkup(
      <EstateBoardDialog
        open
        villas={packet}
        onClose={() => {}}
        onInspectVilla={() => {}}
        onNavigateVilla={() => {}}
      />,
    );
    for (const spec of VILLA_SPECS) {
      expect(html).toContain(spec.name);
    }
    expect(html).toContain('包租婆牛马');
    expect(html).toContain('日进斗金');
    expect(html).toContain('带路前往');
    expect(html).toContain('地契');
  });

  it('ActionBar 在步行、驾车与濒死幽灵态切换操作按钮', () => {
    const footHtml = renderToStaticMarkup(<ActionBar onAction={() => {}} onChat={() => {}} />);
    expect(footHtml).toContain('载具');
    expect(footHtml).toContain('[Q]');
    expect(footHtml).toContain('急救');
    expect(footHtml).toContain('[H]');
    expect(footHtml).toContain('零工');
    expect(footHtml).toContain('[G]');
    expect(footHtml).toContain('WASD 移动 · E 发泄 · Q 上车');

    useGameUi.getState().setDriving(1, 0);
    const driveHtml = renderToStaticMarkup(<ActionBar onAction={() => {}} onChat={() => {}} />);
    expect(driveHtml).toContain('下车');
    expect(driveHtml).toContain('鸣笛');
    expect(driveHtml).toContain('WASD 驾驶 · Shift 加速');

    useGameUi.getState().setDriving(0, 0);
    useGameUi.getState().setGhost({ id: 1, mode: GHOST_MODE.Flatline, cprProgress: 10, leftMs: 10000 });
    expect(renderToStaticMarkup(<ActionBar onAction={() => {}} onChat={() => {}} />)).toContain('灵魂出窍');

    useGameUi.getState().setGhost({ id: 1, mode: GHOST_MODE.Ghost, cprProgress: 0, leftMs: 10000 });
    expect(renderToStaticMarkup(<ActionBar onAction={() => {}} onChat={() => {}} />)).toContain('灵魂游荡');
  });

  it('VillaDialog 仅对当前房主开放三主题与牌匾宣言自定义面板', () => {
    const ownerPacket: VillaStatePacket = {
      villas: [
        {
          id: 0,
          ownerId: 1,
          ownerName: '大老板牛马',
          locked: false,
          owned: true,
          mine: true,
          pending: 50,
          theme: VILLA_THEME.EmeraldOasis,
          tagline: '摸鱼圣地',
        },
      ],
    };
    const ownerHtml = renderToStaticMarkup(
      <VillaDialog
        villa={0}
        villas={ownerPacket}
        coins={500}
        onClose={() => {}}
        onAction={() => {}}
        onCustomize={() => {}}
      />,
    );
    expect(ownerHtml).toContain('主题与牌匾宣言');
    expect(ownerHtml).toContain('暖阳金');
    expect(ownerHtml).toContain('赛博粉');
    expect(ownerHtml).toContain('翡翠森');
    expect(ownerHtml).toContain('保存装修');

    const visitorPacket: VillaStatePacket = {
      villas: [
        {
          ...ownerPacket.villas[0]!,
          mine: false,
        },
      ],
    };
    const visitorHtml = renderToStaticMarkup(
      <VillaDialog
        villa={0}
        villas={visitorPacket}
        coins={500}
        onClose={() => {}}
        onAction={() => {}}
        onCustomize={() => {}}
      />,
    );
    expect(visitorHtml).not.toContain('主题与牌匾宣言');
  });
});
