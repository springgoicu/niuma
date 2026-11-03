import { describe, expect, it } from 'bun:test';
import { COLUMNS, FRAME_SIZE, ROWS } from '../layout';
import { drawFrame, eyeSizeOf, proportionsOf, standHeightOf, type FrameSpec, type SpeciesName } from '../quadruped';
import { isOutlineSlot, S } from '../palette';

const SPECIES: SpeciesName[] = ['cow', 'horse'];

function frameAt(species: SpeciesName, direction: number, column: number, patch: Partial<FrameSpec> = {}) {
  return drawFrame({
    species,
    direction: direction as 0 | 1 | 2 | 3,
    column,
    tail: patch.tail ?? 0,
    pattern: patch.pattern ?? 0,
    extra: patch.extra ?? 0,
    snout: patch.snout ?? 0,
  }).data;
}

function bounds(data: Uint8Array) {
  let minX = FRAME_SIZE;
  let maxX = -1;
  let minY = FRAME_SIZE;
  let maxY = -1;
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      if (data[y * FRAME_SIZE + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe('牛马比例契约', () => {
  it('两个物种站立总高差不超过 2 texel', () => {
    // 并排站在一起时牛不能显矮、马不能显飘：差 2 以内才读成「同一个世界的动物」
    const cow = standHeightOf('cow');
    const horse = standHeightOf('horse');
    expect(Math.abs(cow - horse)).toBeLessThanOrEqual(2);
  });

  it('站立总高落在 46..56：低于 46 太扁，高于 56 在 64 格上会顶到画布边', () => {
    for (const species of SPECIES) {
      const height = standHeightOf(species);
      expect(height).toBeGreaterThan(46);
      expect(height).toBeLessThan(56);
    }
  });

  it('牛明显比马宽，且两者实际剪影高度接近', () => {
    // 「方身子的棕牛」那个 bug 的本质是两物种剪影尺寸几乎一致，只靠颜色区分
    const cow = bounds(frameAt('cow', 2, 0));
    const horse = bounds(frameAt('horse', 2, 0));
    expect(cow.w).toBeGreaterThan(horse.w + 2);
    expect(Math.abs(cow.h - horse.h)).toBeLessThanOrEqual(6);
  });
});

describe('幼态比例（ADR-0014）', () => {
  it('头径至少占站立高的四成：低于这个数就退回「小块头 + 长腿」', () => {
    // 用户反馈「太生硬」的根因是头小、腿长、身方；这一条把头身比钉住，
    // 以后想调腿长 / 颈长时会被它拦下，不会悄悄退回旧比例
    expect(proportionsOf('cow').head).toBeGreaterThanOrEqual(0.42);
    expect(proportionsOf('horse').head).toBeGreaterThanOrEqual(0.36);
  });

  it('腿长不超过站立高的 0.38：再长就从「小短腿」变回板凳', () => {
    for (const species of SPECIES) {
      expect(proportionsOf(species).leg).toBeLessThanOrEqual(0.38);
    }
  });

  it('眼睛至少 5×5：4×4 在 64 格里会读成「眯眼」而不是大眼睛', () => {
    for (const species of SPECIES) {
      const eye = eyeSizeOf(species);
      expect(eye.w).toBeGreaterThanOrEqual(5);
      expect(eye.h).toBeGreaterThanOrEqual(5);
    }
  });

  it('眨眼帧的眼睛比睁眼帧更矮：闭眼不该留一个实心黑块', () => {
    const heightOfEye = (column: number): number => {
      const data = frameAt('cow', 0, column);
      let minY = FRAME_SIZE;
      let maxY = -1;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          if (data[y * FRAME_SIZE + x] !== S.Eye) continue;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return maxY < 0 ? 0 : maxY - minY + 1;
    };
    expect(heightOfEye(2)).toBeLessThan(heightOfEye(0));
  });
});

describe('帧边界与描边', () => {
  it('任何姿态都不越出帧边界：越界的像素会被裁掉，只剩一条断边', () => {
    for (const species of SPECIES) {
      for (let direction = 0; direction < ROWS; direction += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const data = frameAt(species, direction, column, { pattern: 1, extra: 1 });
          for (let i = 0; i < FRAME_SIZE; i += 1) {
            expect(data[i]).toBe(0);
            expect(data[(FRAME_SIZE - 1) * FRAME_SIZE + i]).toBe(0);
            expect(data[i * FRAME_SIZE]).toBe(0);
            expect(data[i * FRAME_SIZE + FRAME_SIZE - 1]).toBe(0);
          }
        }
      }
    }
  });

  it('描边闭合：本体色不许直接贴着透明区', () => {
    // 这条是「远看糊」的回归线：描边一旦断开，角色在深色地面上就没了轮廓
    for (const species of SPECIES) {
      for (let direction = 0; direction < ROWS; direction += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const data = frameAt(species, direction, column, { pattern: 1, extra: 1 });
          for (let y = 1; y < FRAME_SIZE - 1; y += 1) {
            for (let x = 1; x < FRAME_SIZE - 1; x += 1) {
              if (data[y * FRAME_SIZE + x] !== 0) continue;
              const neighbours = [
                data[(y - 1) * FRAME_SIZE + x]!,
                data[(y + 1) * FRAME_SIZE + x]!,
                data[y * FRAME_SIZE + x - 1]!,
                data[y * FRAME_SIZE + x + 1]!,
              ];
              // 贴着一圈描边不算，只有贴着「本体」才算漏边
              if (!neighbours.some((slot) => slot !== 0 && !isOutlineSlot(slot))) continue;
              const outline: number[] = [S.Outline, S.TailOutline];
              expect(outline).toContain(data[y * FRAME_SIZE + x]);
            }
          }
        }
      }
    }
  });
});
