import { describe, expect, it } from 'bun:test';
import { ventOutcome } from '../vent-outcome';

const LOCAL = 7;

function packet(attackerId: number, targetId: number) {
  return { attackerId, targetId, x: 0, y: 0 };
}

describe('vent outcome', () => {
  it('counts as hit only when the local player is the target', () => {
    expect(ventOutcome(packet(3, LOCAL), LOCAL)).toBe('hit');
  });

  it('counts as dealt only when the local player is the attacker and actually hit', () => {
    expect(ventOutcome(packet(LOCAL, 3), LOCAL)).toBe('dealt');
  });

  it('does not count a whiff, even when the local player is the attacker', () => {
    expect(ventOutcome(packet(LOCAL, 0), LOCAL)).toBe('other');
  });

  it('ignores other players fighting each other', () => {
    expect(ventOutcome(packet(3, 4), LOCAL)).toBe('other');
  });

  it('does not match when the local id is still zero', () => {
    expect(ventOutcome(packet(0, 0), 0)).toBe('other');
  });
});
