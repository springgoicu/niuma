import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { VillaDialog } from '../../../components/game/VillaDialog';
import {
  PROPERTY_TIER_LABEL,
  VILLA_SPECS,
  villaBuyPrice,
  villaBuyoutRefund,
  type VillaStatePacket,
} from '@niuma/shared-types';

function renderVilla(options: {
  id?: number;
  owned: boolean;
  mine: boolean;
  ownerId?: number;
  ownerName?: string;
  coins?: number;
}): string {
  const id = options.id ?? 0;
  const spec = VILLA_SPECS[id]!;
  const packet: VillaStatePacket = {
    villas: [
      {
        id,
        ownerId: options.ownerId ?? 0,
        ownerName: options.ownerName ?? '离线房主',
        locked: false,
        owned: options.owned,
        mine: options.mine,
        pending: options.mine ? 25 : 0,
      },
    ],
  };
  return renderToStaticMarkup(
    <VillaDialog
      villa={id}
      villas={packet}
      coins={options.coins ?? villaBuyPrice(spec, options.owned)}
      onClose={() => {}}
      onAction={() => {}}
    />,
  );
}

describe('街区房产地契与 1.5× 溢价收购', () => {
  it('无主房产展示档位标签、标价与首次买下冠名权入口', () => {
    const spec = VILLA_SPECS[0]!;
    const html = renderVilla({ id: 0, owned: false, mine: false, ownerName: '' });
    expect(html).toContain(spec.name);
    expect(html).toContain(PROPERTY_TIER_LABEL[spec.tier]);
    expect(html).toContain(`买下冠名权 · ${spec.price} 币`);
  });

  it('他人房产支持 1.5× 溢价收购并写明原房主获赔 1.2×，离线房主仍正常标注状态', () => {
    const spec = VILLA_SPECS[1]!;
    const offlineHtml = renderVilla({
      id: 1,
      owned: true,
      mine: false,
      ownerId: 0,
      ownerName: '离线房主',
    });
    expect(offlineHtml).toContain('离线房主');
    expect(offlineHtml).toContain('离线');
    expect(offlineHtml).not.toContain('买下冠名权');
    expect(offlineHtml).toContain(`溢价收购 · ${villaBuyPrice(spec, true)} 币`);
    expect(offlineHtml).toContain(`原房主获赔 1.2×（${villaBuyoutRefund(spec)} 币）`);

    const onlineHtml = renderVilla({
      id: 1,
      owned: true,
      mine: false,
      ownerId: 42,
      ownerName: '包租公',
    });
    expect(onlineHtml).toContain('包租公');
    expect(onlineHtml).toContain('在线');
  });

  it('房主本人看到锁门与收币入口，不显示溢价收购', () => {
    const html = renderVilla({ id: 0, owned: true, mine: true, ownerId: 9, ownerName: '我自己' });
    expect(html).toContain('锁门');
    expect(html).toContain('收币 25');
    expect(html).not.toContain('溢价收购');
  });
});
