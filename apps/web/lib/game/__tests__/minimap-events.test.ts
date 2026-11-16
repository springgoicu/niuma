import { describe, expect, it } from 'bun:test';
import { MINIMAP_SIZE, projectEventMarker } from '../minimap-draw';

const CENTER = MINIMAP_SIZE / 2;
const INSET = 6;

describe('projectEventMarker', () => {
  it('视野内原样投影，不贴边也不旋转', () => {
    const marker = projectEventMarker(CENTER + 10, CENTER - 20);
    expect(marker).toEqual({ px: CENTER + 10, py: CENTER - 20, inside: true, angle: 0 });
  });

  it('正东方向的事件贴右边缘，角度指向 0', () => {
    const marker = projectEventMarker(MINIMAP_SIZE * 4, CENTER);
    expect(marker.inside).toBe(false);
    expect(marker.px).toBeCloseTo(MINIMAP_SIZE - INSET);
    expect(marker.py).toBeCloseTo(CENTER);
    expect(marker.angle).toBeCloseTo(0);
  });

  it('正北方向的事件贴上边缘，角度指向 -90°', () => {
    const marker = projectEventMarker(CENTER, -MINIMAP_SIZE * 4);
    expect(marker.py).toBeCloseTo(INSET);
    expect(marker.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('斜向事件仍落在画布内，不会被推到角落外', () => {
    const marker = projectEventMarker(MINIMAP_SIZE * 4, MINIMAP_SIZE * 4);
    expect(marker.inside).toBe(false);
    expect(marker.px).toBeCloseTo(MINIMAP_SIZE - INSET);
    expect(marker.py).toBeCloseTo(MINIMAP_SIZE - INSET);
    expect(marker.angle).toBeCloseTo(Math.PI / 4);
  });

  it('边缘内缩量对四个方向一致，箭头不会顶到画布外', () => {
    const west = projectEventMarker(-MINIMAP_SIZE * 4, CENTER);
    const south = projectEventMarker(CENTER, MINIMAP_SIZE * 4);
    expect(west.px).toBeCloseTo(INSET);
    expect(south.py).toBeCloseTo(MINIMAP_SIZE - INSET);
  });
});
