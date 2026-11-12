import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, sanitizeAppearance, type Species } from '@niuma/shared-types';
import { parseSpeciesParam, resolveCreatorSeed, switchSpeciesAppearance } from '../creator-seed';

/** 默认外观进入 store 前都会过一遍共享钳制，测试也按这个口径取期望值 */
const blank = (species: Species) => sanitizeAppearance(DEFAULT_APPEARANCE[species]);

const cowProfile = {
  name: '夜班实习生',
  appearance: blank('cow'),
  status: '在岗',
};

describe('入口物种参数', () => {
  it('只认 cow / horse，其余一律当没传', () => {
    expect(parseSpeciesParam('cow')).toBe('cow');
    expect(parseSpeciesParam('horse')).toBe('horse');

    for (const raw of ['Horse', 'dragon', '', ' ', undefined, null]) {
      expect(parseSpeciesParam(raw)).toBeNull();
    }
  });

  it('重复参数与空数组按第一条读，与 /play 的取法一致', () => {
    expect(parseSpeciesParam(['horse', 'cow'])).toBe('horse');
    expect(parseSpeciesParam(['dragon', 'horse'])).toBeNull();
    expect(parseSpeciesParam([])).toBeNull();
  });
});

describe('切物种', () => {
  it('同物种直接返回原外观，不重建也不标脏', () => {
    const appearance = blank('cow');
    expect(switchSpeciesAppearance(appearance, 'cow')).toBe(appearance);
  });

  it('换物种保留 11 个色槽，其余回到新物种默认值', () => {
    const cow = blank('cow');
    const horse = switchSpeciesAppearance(cow, 'horse');
    const horseDefault = blank('horse');

    expect(horse.species).toBe('horse');
    expect(horse.colors).toEqual(cow.colors);
    expect(horse.parts.patternId).toBe(horseDefault.parts.patternId);
    expect(horse.parts.maneId).toBe(horseDefault.parts.maneId);
    expect(horse.parts.hornId).toBeUndefined();
    expect(horse.cosmetics).toEqual(horseDefault.cosmetics);
  });

  it('反向切回牛时角槽位重新出现', () => {
    const horse = blank('horse');
    const cow = switchSpeciesAppearance(horse, 'cow');

    expect(cow.species).toBe('cow');
    expect(cow.colors).toEqual(horse.colors);
    expect(cow.parts.hornId).toBe(blank('cow').parts.hornId);
    expect(cow.parts.maneId).toBeUndefined();
  });
});

describe('捏人页初始状态', () => {
  it('没有任何来源时回到牛的默认外观', () => {
    const seed = resolveCreatorSeed(null, null, null);

    expect(seed.name).toBe('');
    expect(seed.status).toBe('');
    expect(seed.dirty).toBe(false);
    expect(seed.appearance).toEqual(blank('cow'));
  });

  it('没有存档时入口参数优先于记忆键', () => {
    expect(resolveCreatorSeed(null, 'cow', 'horse').appearance.species).toBe('cow');
    expect(resolveCreatorSeed(null, 'horse', 'cow').appearance.species).toBe('horse');
  });

  it('没有入口参数时用上次显式选择的物种', () => {
    const seed = resolveCreatorSeed(null, null, 'horse');

    expect(seed.appearance).toEqual(blank('horse'));
    expect(seed.name).toBe('');
    expect(seed.dirty).toBe(false);
  });

  it('有存档时原样恢复，记忆键不能改写存档物种', () => {
    const seed = resolveCreatorSeed(cowProfile, null, 'horse');

    expect(seed.name).toBe('夜班实习生');
    expect(seed.status).toBe('在岗');
    expect(seed.appearance).toEqual(cowProfile.appearance);
    expect(seed.dirty).toBe(false);
  });

  it('入口物种与存档相同：沿用存档外观且不算草稿未保存', () => {
    const seed = resolveCreatorSeed(cowProfile, 'cow', 'horse');

    expect(seed.appearance).toEqual(cowProfile.appearance);
    expect(seed.dirty).toBe(false);
  });

  it('入口物种与存档不同：保留色槽切物种，并标记草稿未保存', () => {
    const seed = resolveCreatorSeed(cowProfile, 'horse', null);

    expect(seed.appearance.species).toBe('horse');
    expect(seed.appearance.colors).toEqual(cowProfile.appearance.colors);
    expect(seed.name).toBe('夜班实习生');
    expect(seed.status).toBe('在岗');
    expect(seed.dirty).toBe(true);
  });
});
