import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, resolveMotionInto } from '../world/collision';
import { CLINIC_ACCESS_PAVING, CLINIC_DROP, CLINIC_RECT } from '../world/clinic';
import { isInClinicInterior, resolveWalkInto } from '../world/clinic-gate';

const GATE_Y = CLINIC_ACCESS_PAVING.y + Math.floor(CLINIC_ACCESS_PAVING.h / 2);

describe('护士急救站开放通行门禁（Stage 1 优化）', () => {
  it('健康玩家可自由从西侧大门步入急诊大厅', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, CLINIC_RECT.x - 16, GATE_Y, CLINIC_RECT.x + 48, GATE_Y);
    expect(blocked).toBe(false);
    expect(out.x).toBeGreaterThan(CLINIC_RECT.x);
    expect(isInClinicInterior(out.x, out.y)).toBe(true);
  });

  it('站内人员也可自由走动或走出西门 / 南车道', () => {
    const out = { x: 0, y: 0 };
    const exitWest = resolveWalkInto(out, CLINIC_RECT.x + 30, GATE_Y, CLINIC_RECT.x - 50, GATE_Y);
    expect(exitWest).toBe(false);
    expect(out.x).toBeLessThan(CLINIC_RECT.x);

    const walkSouth = resolveWalkInto(out, CLINIC_RECT.x + 98, CLINIC_RECT.y + CLINIC_RECT.h - 10, CLINIC_RECT.x + 98, CLINIC_RECT.y + CLINIC_RECT.h + 40);
    expect(walkSouth).toBe(false);
    expect(out.y).toBeGreaterThan(CLINIC_RECT.y + CLINIC_RECT.h);
  });

  it('围墙与柜台碰撞依然有效，不会因为开大门而穿墙', () => {
    const out = { x: 0, y: 0 };
    resolveWalkInto(out, CLINIC_RECT.x - 30, CLINIC_RECT.y + 18, CLINIC_RECT.x + 30, CLINIC_RECT.y + 18, PLAYER_RADIUS);
    expect(out.x).toBeLessThan(CLINIC_RECT.x);
    expect(isInClinicInterior(out.x, out.y)).toBe(false);
  });

  it('救护车地形求解照样畅通进站放人', () => {
    const out = { x: 0, y: 0 };
    resolveMotionInto(out, CLINIC_RECT.x + 98, CLINIC_RECT.y + 286, CLINIC_DROP.x, CLINIC_DROP.y);
    expect(isInClinicInterior(out.x, out.y)).toBe(true);
    expect(out.x).toBeCloseTo(CLINIC_DROP.x, 5);
    expect(out.y).toBeCloseTo(CLINIC_DROP.y, 5);
  });
});
