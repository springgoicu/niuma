import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  displayWidth,
  MAX_NAME_DISPLAY_UNITS,
  MAX_STATUS_DISPLAY_UNITS,
  type CharacterAppearance,
} from '@niuma/shared-types';
import {
  bubbleTopY,
  headTopYOf,
  nameBottomY,
  nameClearanceFor,
  nameplateText,
  statusBottomY,
  statusLabelText,
  statusStackHeight,
  NAME_STROKE_WIDTH,
  STATUS_GAP,
} from '../nameplate';

/** 锚点结构同 manifest.cosmeticAnchors：物种 → 朝向 → 帧列 → 类别 */
const MANIFEST = {
  cosmeticAnchors: {
    cow: {
      down: { '0': { head: [0, -46] as [number, number] } },
      left: { '0': { head: [0, -47] as [number, number] } },
      right: { '0': { head: [0, -47] as [number, number] } },
      up: { '0': { head: [0, -45] as [number, number] } },
    },
    horse: {
      down: { '0': { head: [0, -47] as [number, number] } },
    },
  },
};

function bare(species: 'cow' | 'horse'): CharacterAppearance {
  const base = DEFAULT_APPEARANCE[species];
  return {
    ...base,
    parts: { ...base.parts, hornId: 0, maneId: 0 },
    cosmetics: { ...base.cosmetics, headwear: 'none', hairstyle: 'none' },
  };
}

function withCosmetics(appearance: CharacterAppearance, patch: CharacterAppearance['cosmetics']): CharacterAppearance {
  return { ...appearance, cosmetics: { ...appearance.cosmetics, ...patch } };
}

describe('头顶解析', () => {
  it('取所有朝向里最高的头顶，坐躺锚点不会把昵称拉低', () => {
    expect(headTopYOf(MANIFEST, 'cow')).toBe(-47);
  });

  it('缺锚点时回退到站立头顶，而不是退回脚底', () => {
    expect(headTopYOf({}, 'cow')).toBeLessThan(-40);
  });
});

describe('昵称避让量', () => {
  const cow = bare('cow');
  const headTop = headTopYOf(MANIFEST, 'cow');

  it('裸头只需让出 1 纹素', () => {
    expect(nameClearanceFor(cow)).toBe(1);
  });

  it('角 / 发型 / 帽子依次让得更多', () => {
    const horned: CharacterAppearance = { ...cow, parts: { ...cow.parts, hornId: 2 } };
    const haired = withCosmetics(cow, { hairstyle: 'afro' });
    const hatted = withCosmetics(cow, { headwear: 'top' });
    expect(nameClearanceFor(horned)).toBeGreaterThan(nameClearanceFor(cow));
    expect(nameClearanceFor(haired)).toBeGreaterThan(nameClearanceFor(cow));
    expect(nameClearanceFor(hatted)).toBeGreaterThan(nameClearanceFor(haired));
  });

  it('昵称底边永远高于头顶，不可能再落到膝盖上', () => {
    const appearances: CharacterAppearance[] = [
      cow,
      { ...cow, parts: { ...cow.parts, hornId: 2 } },
      withCosmetics(cow, { hairstyle: 'afro' }),
      withCosmetics(cow, { headwear: 'helmet' }),
      withCosmetics(cow, { headwear: 'top', hairstyle: 'slick' }),
      bare('horse'),
    ];
    for (const appearance of appearances) {
      const top = headTopYOf(MANIFEST, appearance.species);
      const bottom = nameBottomY(top, appearance);
      expect(bottom).toBeLessThanOrEqual(top - 1);
      // 描边溢出后仍在头顶之上
      expect(bottom + NAME_STROKE_WIDTH / 2).toBeLessThanOrEqual(top);
    }
  });
});

describe('头顶昵称文本', () => {
  it('16 个半角字符正好放满，不会被截', () => {
    expect(nameplateText('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  });

  it('8 个汉字占满 16 宽，也不会被截', () => {
    expect(nameplateText('夜班加班实习生牛')).toBe('夜班加班实习生牛');
    expect(displayWidth('夜班加班实习生牛')).toBe(MAX_NAME_DISPLAY_UNITS);
  });

  it('超过 16 宽的昵称换省略号，宽度不再横跨身位', () => {
    const text = nameplateText('夜班加班实习生的老黄牛');
    expect(text.endsWith('…')).toBe(true);
    expect(displayWidth(text)).toBeLessThanOrEqual(MAX_NAME_DISPLAY_UNITS);
    expect(text).toBe('夜班加班实习生…');
  });

  it('首尾空白先裁掉再计宽', () => {
    expect(nameplateText('  实习生  ')).toBe('实习生');
  });
});

describe('气泡堆叠', () => {
  it('气泡整体落在昵称上沿之外，并留出固定间隙', () => {
    const nameBottom = -50;
    const nameHeight = 12;
    const bubbleHeight = 24;
    const top = bubbleTopY(nameBottom, nameHeight, bubbleHeight);
    const bubbleBottom = top + bubbleHeight;
    const nameTop = nameBottom - nameHeight;
    expect(bubbleBottom).toBeLessThan(nameTop);
    expect(nameTop - bubbleBottom).toBe(2);
  });

  it('气泡变高时只向上生长，底边不动', () => {
    const base = bubbleTopY(-50, 12, 20) + 20;
    expect(bubbleTopY(-50, 12, 60) + 60).toBe(base);
  });

  it('没有状态时堆叠高度为 0，气泡几何与旧版逐像素一致', () => {
    expect(statusStackHeight(0)).toBe(0);
    expect(bubbleTopY(-50, 12, 24, 0)).toBe(bubbleTopY(-50, 12, 24));
  });

  it('有状态时气泡整体再上移「状态高度 + 间隙」，不会压在状态上', () => {
    const statusHeight = 10;
    const withStatus = bubbleTopY(-50, 12, 24, statusStackHeight(statusHeight));
    const without = bubbleTopY(-50, 12, 24, 0);
    expect(without - withStatus).toBe(statusHeight + STATUS_GAP);
    // 气泡底边仍严格高于状态行上沿
    const statusTop = statusBottomY(-50, 12) - statusHeight;
    expect(withStatus + 24).toBeLessThan(statusTop);
  });
});

describe('状态行', () => {
  it('状态行贴在昵称上沿之外，不会被昵称压住', () => {
    const nameBottom = -50;
    const nameHeight = 12;
    const bottom = statusBottomY(nameBottom, nameHeight);
    expect(bottom).toBe(nameBottom - nameHeight - STATUS_GAP);
    expect(bottom).toBeLessThan(nameBottom - nameHeight);
  });

  it('状态文本同样截到 16 显示宽，空串表示不显示', () => {
    expect(statusLabelText('摸鱼中🐟')).toBe('摸鱼中🐟');
    // 省略号也吃预算，截断后可能停在 15 宽：只要不超 16，就不会横跨身位
    expect(displayWidth(statusLabelText('摸鱼中🐟摸鱼中🐟摸'))).toBeLessThanOrEqual(
      MAX_STATUS_DISPLAY_UNITS,
    );
    expect(displayWidth(statusLabelText('🐟'.repeat(9)))).toBeLessThanOrEqual(MAX_STATUS_DISPLAY_UNITS);
    expect(statusLabelText('   ')).toBe('');
  });
});
