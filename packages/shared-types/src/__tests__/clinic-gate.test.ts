import { describe, expect, it } from 'vitest';
import { resolveMotionInto } from '../world/collision';
import { CLINIC_DROP, CLINIC_RECT } from '../world/clinic';
import { isInClinicInterior, resolveWalkInto } from '../world/clinic-gate';

/** 西门洞正中：门洞 y 3722–3778，站内地面西沿 x = CLINIC_RECT.x */
const GATE_Y = 3750;
/** 站内靠近西门的空地（导医柜台与病床之间） */
const INSIDE_WEST = { x: CLINIC_RECT.x + 30, y: GATE_Y };

describe('护士急救站门禁（ADR-0107）', () => {
  it('站外从西门直着往里走会被夹回门线', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, CLINIC_RECT.x - 10, GATE_Y, CLINIC_RECT.x + 30, GATE_Y);
    expect(blocked).toBe(true);
    expect(out.x).toBeLessThan(CLINIC_RECT.x);
    expect(out.y).toBeCloseTo(GATE_Y, 5);
    expect(isInClinicInterior(out.x, out.y)).toBe(false);
  });

  it('停在门线上再往里挪一步仍然被挡', () => {
    const out = { x: 0, y: 0 };
    resolveWalkInto(out, CLINIC_RECT.x - 10, GATE_Y, CLINIC_RECT.x + 30, GATE_Y);
    const x = out.x;
    const y = out.y;
    const blocked = resolveWalkInto(out, x, y, x + 4, y);
    expect(blocked).toBe(true);
    expect(out.x).toBeLessThan(CLINIC_RECT.x);
    expect(Math.abs(out.x - x)).toBeLessThan(1);
  });

  it('斜着走向门里时保留切向分量，贴着门框滑行而不是原地定住', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, CLINIC_RECT.x - 8, GATE_Y - 15, CLINIC_RECT.x + 15, GATE_Y + 10);
    expect(blocked).toBe(true);
    expect(isInClinicInterior(out.x, out.y)).toBe(false);
    // 被挡住的是向内的法向，沿门洞的纵向位移要照常发生
    expect(out.y).toBeGreaterThan(GATE_Y - 15 + 3);
  });

  it('南侧救护车通道同样只挡脚不走车', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, CLINIC_RECT.x + 100, 3900, CLINIC_RECT.x + 100, 3850);
    expect(blocked).toBe(true);
    expect(out.y).toBeGreaterThan(CLINIC_RECT.y + CLINIC_RECT.h);
    expect(isInClinicInterior(out.x, out.y)).toBe(false);
  });

  it('已经在站里的伤员可以自己走出西门', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, INSIDE_WEST.x, INSIDE_WEST.y, CLINIC_RECT.x - 60, GATE_Y);
    expect(blocked).toBe(false);
    expect(out.x).toBeLessThan(CLINIC_RECT.x);
    expect(isInClinicInterior(out.x, out.y)).toBe(false);
  });

  it('站内仍然可以自由走动', () => {
    const out = { x: 0, y: 0 };
    const blocked = resolveWalkInto(out, CLINIC_DROP.x, CLINIC_DROP.y, CLINIC_RECT.x + 60, CLINIC_RECT.y + 130);
    expect(blocked).toBe(false);
    expect(out.x).toBeCloseTo(CLINIC_RECT.x + 60, 5);
    expect(out.y).toBeCloseTo(CLINIC_RECT.y + 130, 5);
    expect(isInClinicInterior(out.x, out.y)).toBe(true);
  });

  it('从站外任意角度冲进来都停在站外', () => {
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const fromX = CLINIC_RECT.x - 24;
      const fromY = GATE_Y;
      // 单帧步长上限约 55px：取 60px，跨不过 210px 高的站内地面，端点判定就等价于整段
      const toX = fromX + Math.cos(angle) * 60;
      const toY = fromY + Math.sin(angle) * 60;
      resolveWalkInto(out, fromX, fromY, toX, toY);
      expect(isInClinicInterior(out.x, out.y), `angle ${i}`).toBe(false);
    }
  });

  it('非有限目标点不会把玩家留在站内', () => {
    const out = { x: 0, y: 0 };
    resolveWalkInto(out, CLINIC_RECT.x - 24, GATE_Y, Number.NaN, GATE_Y);
    expect(out.x).toBe(CLINIC_RECT.x - 24);
    expect(out.y).toBe(GATE_Y);
  });

  it('救护车走的仍是地形求解，可以直插站内落点', () => {
    const out = { x: 0, y: 0 };
    resolveMotionInto(out, CLINIC_RECT.x + 100, 3960, CLINIC_DROP.x, CLINIC_DROP.y);
    expect(isInClinicInterior(out.x, out.y)).toBe(true);
    expect(out.x).toBeCloseTo(CLINIC_DROP.x, 5);
    expect(out.y).toBeCloseTo(CLINIC_DROP.y, 5);
  });

  it('门线本身不算站内，严格内点才算', () => {
    expect(isInClinicInterior(CLINIC_RECT.x, GATE_Y)).toBe(false);
    expect(isInClinicInterior(CLINIC_RECT.x - 0.5, GATE_Y)).toBe(false);
    expect(isInClinicInterior(CLINIC_RECT.x + 1, CLINIC_RECT.y + 1)).toBe(true);
  });
});
