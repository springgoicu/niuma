import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArenaBetDialog } from '../../../components/game/ArenaBetDialog';
import { VillaDialog } from '../../../components/game/VillaDialog';
import { VILLA_PRICE, type VillaStatePacket } from '@niuma/shared-types';

function arena(seated: boolean): string {
  return renderToStaticMarkup(
    <ArenaBetDialog
      pool={null}
      ring={null}
      coins={1_000}
      seated={seated}
      onClose={() => {}}
      onBet={() => {}}
    />,
  );
}

function villa(mine: boolean): string {
  const packet: VillaStatePacket = {
    villas: [
      {
        id: 0,
        ownerId: 0,
        ownerName: '离线房主',
        locked: false,
        owned: true,
        mine,
        pending: mine ? 25 : 0,
      },
    ],
  };
  return renderToStaticMarkup(
    <VillaDialog villa={0} villas={packet} coins={VILLA_PRICE} onClose={() => {}} onAction={() => {}} />,
  );
}

describe('观战押注面板（ADR-0104）', () => {
  it('离座后按钮禁用，并直接告诉玩家先坐长椅', () => {
    const html = arena(false);
    expect(html).toContain('先坐上观战长椅');
    expect(html).toContain('disabled');
  });

  it('坐回长椅才恢复可押状态', () => {
    const html = arena(true);
    expect(html).not.toContain('先坐上观战长椅');
    // 没在比赛中时仍禁用，但文案是阶段原因，不再是座位原因
    expect(html).toContain('等下一场');
  });
});

describe('别墅归属（ADR-0104）', () => {
  it('房主离线仍显示已拥有，不再出现购买按钮', () => {
    const html = villa(false);
    expect(html).toContain('离线房主');
    expect(html).not.toContain('买下冠名权');
    expect(html).toContain('这是别人的院子');
  });

  it('房主本人看到锁门与收币入口', () => {
    const html = villa(true);
    expect(html).toContain('锁门');
    expect(html).toContain('收币 25');
    expect(html).not.toContain('这是别人的院子');
  });
});
