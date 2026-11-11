import { describe, expect, it } from 'bun:test';
import { FRAME_SIZE, ORIGIN } from '../layout';
import { S } from '../palette';
import { drawFrame, landmarksOf, type SpeciesName } from '../quadruped';

const SPECIES: SpeciesName[] = ['cow', 'horse'];

/** 站立基准帧 / 坐定帧 / 躺定帧（列号见 layout.ts 的 CLIPS） */
const STAND = 0;
const SIT = 9;
const LIE = 11;

/** 脚底线：与 quadruped.ts 的 FEET 同源（ORIGIN.y），蹄子永远落在这里 */
const FEET = ORIGIN.y;

function frameAt(species: SpeciesName, direction: number, column: number): Uint8Array {
  return drawFrame({
    species,
    direction: direction as 0 | 1 | 2 | 3,
    column,
    tail: 0,
    pattern: 0,
    extra: 0,
    snout: 0,
  }).data;
}

/** 逐像素差异：坐姿一旦悄悄退回站姿，这条会先掉下来 */
function diffCount(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}

/** 某一行的实心段长度序列：用来数「贴地那一行是几条腿 / 一整块后躯」 */
function runsAt(data: Uint8Array, y: number, onlySlot?: number): number[] {
  const runs: number[] = [];
  let len = 0;
  for (let x = 0; x < FRAME_SIZE; x += 1) {
    const value = data[y * FRAME_SIZE + x]!;
    const on = onlySlot === undefined ? value !== 0 : value === onlySlot;
    if (on) {
      len += 1;
    } else {
      if (len > 0) runs.push(len);
      len = 0;
    }
  }
  if (len > 0) runs.push(len);
  return runs;
}

/**
 * 躯干中线带（BODY_CX = 26 附近，避开侧视的头部与前腿）最靠上的不透明像素。
 * 侧视量到的是背线，正视 / 背视量到的是头顶——两者都该随坐下明显下移。
 */
function topAtMidBand(data: Uint8Array): number {
  let top = FRAME_SIZE;
  for (let x = 22; x <= 30; x += 1) {
    for (let y = 0; y < FRAME_SIZE; y += 1) {
      if (!data[y * FRAME_SIZE + x]) continue;
      if (y < top) top = y;
      break;
    }
  }
  return top;
}

describe('坐姿可读性：坐下必须与站立一眼可分（ADR-0031）', () => {
  it('坐姿与站立的剪影差异足够大：三向都不是「站着多了个鼓包」', () => {
    // 几何调参最容易滑回「只挪几个像素」，这里钉住一个几百像素的下限
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const d = diffCount(frameAt(species, direction, STAND), frameAt(species, direction, SIT));
        expect(d, `${species} · direction ${direction}`).toBeGreaterThanOrEqual(500);
      }
    }
  });

  it('躯干中线比站立压低：坐下是「整只动物趴下去」，不是原高度换个腿位', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const stand = topAtMidBand(frameAt(species, direction, STAND));
        const sit = topAtMidBand(frameAt(species, direction, SIT));
        // 实测 4–5：只锁下限，允许以后微调头部高度而不放宽「明显」这条线
        expect(sit - stand, `${species} · direction ${direction}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('侧视坐姿：后躯压在地上，脚底线那一行连成一整块', () => {
    // 站姿在 FEET-2 只有两根腿柱（最宽 ≤14），坐下以后腿柱与后躯连成一片（≥24）。
    // 这是「坐」与「站」在侧视里最本质的差别，比整体高度更稳。
    for (const species of SPECIES) {
      for (const direction of [1, 2]) {
        const standWidest = Math.max(...runsAt(frameAt(species, direction, STAND), FEET - 2));
        const sitWidest = Math.max(...runsAt(frameAt(species, direction, SIT), FEET - 2));
        expect(sitWidest, `${species} · direction ${direction}`).toBeGreaterThanOrEqual(
          Math.round(standWidest * 1.8),
        );
      }
    }
  });

  it('正 / 背视坐姿：贴地处只数得出两条前腿，后腿不落地', () => {
    // 蹄子是唯一会用 S.Hoof 落笔的地方：贴地三行只剩两段 = 两条前腿；
    // 后腿一旦也画成落地柱，这里会变成三四段。
    for (const species of SPECIES) {
      for (const direction of [0, 3]) {
        const data = frameAt(species, direction, SIT);
        for (const y of [FEET - 3, FEET - 2, FEET - 1]) {
          const runs = runsAt(data, y, S.Hoof);
          expect(runs.length, `${species} · direction ${direction} · row ${y}`).toBe(2);
          for (const run of runs) expect(run).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it('坐与躺仍是两套姿势：坐姿的头明显高于躺姿', () => {
    // 坐姿压得越低越容易和床上那套躺姿糊在一起，这条是两者不混的回归线
    for (const species of SPECIES) {
      for (const direction of [0, 3]) {
        const sitHead = landmarksOf(species, direction as 0 | 3, SIT).head[1];
        const lieHead = landmarksOf(species, direction as 0 | 3, LIE).head[1];
        expect(lieHead - sitHead, `${species} · direction ${direction}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
