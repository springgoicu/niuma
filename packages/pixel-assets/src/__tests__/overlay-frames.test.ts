import { describe, expect, it } from 'bun:test';
import { FRAME_SIZE, ORIGIN } from '../layout';
import { S } from '../palette';
import { drawFrame, landmarksOf, type SpeciesName } from '../quadruped';

const SPECIES: SpeciesName[] = ['cow', 'horse'];

/** 发泄三套：后撤蓄力 → 前冲头槌 → 后坐力（ADR-0051） */
const VENT = {
  vent: [16, 17, 18],
  sitVent: [19, 20, 21],
  lieVent: [22, 23, 24],
} as const;

/** 跳：蹲下帧 → 腾空帧，差异必须是整体位移而不是嘴 */
const JUMP = [13, 14] as const;

/** 打招呼三套：抬蹄 → 挥出 → 收回（ADR-0019） */
const WAVE = {
  wave: [25, 26, 27],
  sitWave: [28, 29, 30],
  lieWave: [31, 32, 33],
} as const;
/** 三套挥手各自的静息对照帧：站 / 坐 / 躺 */
const WAVE_REST = { wave: 0, sitWave: 9, lieWave: 11 } as const;

function render(species: SpeciesName, direction: number, column: number): Uint8Array {
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

interface Diff {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

function diff(a: Uint8Array, b: Uint8Array): Diff {
  let count = 0;
  let minX = FRAME_SIZE;
  let maxX = -1;
  let minY = FRAME_SIZE;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      if (a[y * FRAME_SIZE + x] === b[y * FRAME_SIZE + x]) continue;
      count += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    count,
    minX,
    maxX,
    minY,
    maxY,
    cx: count > 0 ? sumX / count : -1,
    cy: count > 0 ? sumY / count : -1,
  };
}

/** 锚点是相对脚底原点的，换算回帧内像素坐标 */
function toFrame(point: readonly [number, number]): [number, number] {
  return [point[0] + ORIGIN.x, point[1] + ORIGIN.y];
}

/** 逐点差异：判「差异有没有落进某个形状」时就地取坐标，比包围盒精确 */
function diffPoints(a: Uint8Array, b: Uint8Array): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      if (a[y * FRAME_SIZE + x] !== b[y * FRAME_SIZE + x]) points.push([x, y]);
    }
  }
  return points;
}

/**
 * 1px 高、上下两行都空的速度线。
 *
 * 这条判据专挑「孤立的一行暗色」：角色自身的描边上下总贴着填充色，
 * 只有画在描边之后、离开身体的那一小段拖影满足条件。
 */
function countSpeedLines(data: Uint8Array): number {
  let count = 0;
  for (let y = 2; y < FRAME_SIZE - 2; y += 1) {
    let run = 0;
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const here = data[y * FRAME_SIZE + x]!;
      const isolated =
        here === S.Outline &&
        data[(y - 1) * FRAME_SIZE + x] === 0 &&
        data[(y - 2) * FRAME_SIZE + x] === 0 &&
        data[(y + 1) * FRAME_SIZE + x] === 0 &&
        data[(y + 2) * FRAME_SIZE + x] === 0;
      run = isolated ? run + 1 : 0;
      // 一段 2px 以上连续的水平暗线才算一根速度线
      if (run === 2) count += 1;
    }
  }
  return count;
}

describe('发泄帧：后撤蓄力 → 前冲头槌 → 后坐力', () => {
  it('三帧两两不同，且改变量远超旧「只动嘴」的量级', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const frames of Object.values(VENT)) {
          for (let i = 1; i < frames.length; i += 1) {
            const d = diff(render(species, direction, frames[i - 1]!), render(species, direction, frames[i]!));
            expect(d.count).toBeGreaterThan(0);
          }
          // 蓄力 → 冲撞：整只身体下沉 + 前冲 + 前蹄下砸，量级必须是两位数以上
          const charge = diff(render(species, direction, frames[0]!), render(species, direction, frames[1]!));
          expect(charge.count).toBeGreaterThan(20);
        }
      }
    }
  });

  it('冲撞帧不只动头：前蹄与躯干一起参与，差异一路延伸到脚底附近', () => {
    for (const species of SPECIES) {
      // 侧视才看得到前蹄下砸，正 / 背视只有头与身体
      for (const direction of [1, 2]) {
        const d = diff(render(species, direction, 16), render(species, direction, 17));
        const head = toFrame(landmarksOf(species, direction, 17).head);
        expect(d.count).toBeGreaterThan(40);
        // 差异的最下沿必须明显低于头心：只动脑袋的话会在头底就收住
        expect(d.maxY).toBeGreaterThan(head[1] + 10);
      }
    }
  });

  it('冲撞帧带 1px 速度线，蓄力帧与复位帧没有', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const frames of Object.values(VENT)) {
          expect(countSpeedLines(render(species, direction, frames[1]))).toBeGreaterThanOrEqual(1);
          expect(countSpeedLines(render(species, direction, frames[0]))).toBe(0);
          expect(countSpeedLines(render(species, direction, frames[2]))).toBe(0);
        }
      }
    }
  });

  it('不再有张嘴帧：吻部暗格不随帧增加', () => {
    // 吻部暗格（鼻孔 + 嘴线）是唯一用 SnoutShade 落笔的地方。
    // 旧的「张嘴呼叫」帧靠「第二拍多一块 3×1.6 的暗格」表达发声，这里守住它已经彻底消失：
    // 容差 ±1 只吸收整数位移带来的椭圆栅格抖动，张嘴会多出 3 个以上像素。
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const rest = render(species, direction, 0);
        let restSnout = 0;
        for (let i = 0; i < rest.length; i += 1) {
          if (rest[i] === S.SnoutShade) restSnout += 1;
        }
        for (const column of [16, 17, 18, 19, 20, 21, 22, 23, 24]) {
          const frame = render(species, direction, column);
          let frameSnout = 0;
          for (let i = 0; i < frame.length; i += 1) {
            if (frame[i] === S.SnoutShade) frameSnout += 1;
          }
          expect(frameSnout).toBeLessThanOrEqual(restSnout + 1);
        }
      }
    }
  });

  it('四向顶行仍为空：头槌不会把牛角 / 鬃毛顶出 64 帧', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const frames of Object.values(VENT)) {
          for (const column of frames) {
            for (const extra of [0, 1, 2, 3]) {
              const data = drawFrame({
                species,
                direction: direction as 0 | 1 | 2 | 3,
                column,
                tail: 0,
                pattern: 0,
                extra,
                snout: 0,
              }).data;
              for (let x = 0; x < FRAME_SIZE; x += 1) {
                expect(data[x]!).toBe(0);
              }
            }
          }
        }
      }
    }
  });
});

describe('跳跃帧：整体位移，与其它一次性动作区分得开', () => {
  it('腾空帧与蹲下帧的差异远大于嘴部级别的变化', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const d = diff(render(species, direction, JUMP[0]), render(species, direction, JUMP[1]));
        // 全身轮廓都会挪动，量级在数百像素；只动嘴那种变化只有个位数
        expect(d.count).toBeGreaterThan(200);
      }
    }
  });

});

describe('挥手帧：只抬一条前腿', () => {
  it('三拍互不相同：抬蹄 → 挥出 → 收回不能有两帧同图', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const frames of Object.values(WAVE)) {
          for (let i = 1; i < frames.length; i += 1) {
            const d = diff(render(species, direction, frames[i - 1]!), render(species, direction, frames[i]!));
            expect(d.count).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('挥手不会把牛角 / 鬃毛顶出 64 帧：四向顶行仍为空', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const frames of Object.values(WAVE)) {
          for (const column of frames) {
            for (const extra of [1, 2]) {
              const data = drawFrame({
                species,
                direction: direction as 0 | 1 | 2 | 3,
                column,
                tail: 0,
                pattern: 0,
                extra,
                snout: 0,
              }).data;
              for (let x = 0; x < FRAME_SIZE; x += 1) {
                expect(data[x]!).toBe(0);
              }
            }
          }
        }
      }
    }
  });

  it('站姿挥手只改前腿：身体与头保持原位，差异锁定在前腿那一列', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const d = diff(render(species, direction, WAVE.wave[0]), render(species, direction, WAVE.wave[1]));
        // 抬腿会同时抹掉落地腿、画出举起的腿：几十个像素，远小于整体位移的数百
        expect(d.count).toBeGreaterThan(0);
        expect(d.count).toBeLessThan(200);
        // 横向跨度不超过一个身位：整只动物挪位会让跨度撑满整帧
        expect(d.maxX - d.minX).toBeLessThanOrEqual(18);

        // 差异一个像素都不许落进头部椭圆：头、耳、角、眼、嘴全都保持原样
        // （正视 / 背视的蹄子举到头侧，只看 y 不够，必须按头形判）
        const marks = landmarksOf(species, direction, WAVE.wave[0]);
        const head = toFrame(marks.head);
        const top = toFrame(marks.headTop);
        const muzzle = toFrame(marks.muzzle);
        const rx = muzzle[0] - head[0] + 2.5;
        const ry = head[1] - top[1] + 1;
        for (const [x, y] of diffPoints(render(species, direction, WAVE.wave[0]), render(species, direction, WAVE.wave[1]))) {
          const inside = ((x - head[0]) / rx) ** 2 + ((y - head[1]) / ry) ** 2;
          expect(inside).toBeGreaterThan(1);
        }
      }
    }
  });

  it('坐姿与躺姿挥手同样只动前蹄，不带动躯干呼吸', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const pose of ['sitWave', 'lieWave'] as const) {
          const rest = WAVE_REST[pose];
          const frames = WAVE[pose];
          const d = diff(render(species, direction, rest), render(species, direction, frames[1]));
          expect(d.count).toBeGreaterThan(0);
          expect(d.count).toBeLessThan(220);
          expect(d.maxX - d.minX).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('挥手不张嘴：嘴线（吻部暗格）一个像素都不许变', () => {
    // 嘴是唯一会用 SnoutShade 画暗格的地方；挥手只要不动这些像素，就不可能「顺手张个嘴」
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        const rest = render(species, direction, WAVE_REST.wave);
        for (const column of WAVE.wave) {
          const wave = render(species, direction, column);
          for (let i = 0; i < rest.length; i += 1) {
            if (rest[i] !== S.SnoutShade) continue;
            expect(wave[i], `${species} · direction ${direction} · column ${column}`).toBe(rest[i]!);
          }
        }
      }
    }
  });
});

describe('跳跃帧：腾空帧不越界', () => {
  it('腾空帧不会被 64 帧裁边：带角 / 鬃的变体顶行仍为空', () => {
    // 腾空 -6 贴着帧顶走：多 1px 描边就会被裁，观感是「角被削平」
    for (const species of SPECIES) {
      for (let direction = 0; direction < 4; direction += 1) {
        for (const extra of [1, 2, 3]) {
          const data = drawFrame({
            species,
            direction: direction as 0 | 1 | 2 | 3,
            column: JUMP[1],
            tail: 0,
            pattern: 0,
            extra,
            snout: 0,
          }).data;
          for (let x = 0; x < FRAME_SIZE; x += 1) {
            expect(data[x]!).toBe(0);
          }
        }
      }
    }
  });
});
