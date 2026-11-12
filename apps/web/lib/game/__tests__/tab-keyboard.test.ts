import { describe, expect, it } from 'bun:test';
import { nextTabIndex } from '../tab-keyboard';

describe('tab keyboard', () => {
  it('moves right and wraps to the first tab', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(1, 'ArrowRight', 3)).toBe(2);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
  });

  it('moves left and wraps to the last tab', () => {
    expect(nextTabIndex(2, 'ArrowLeft', 3)).toBe(1);
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
  });

  it('jumps to the first and last tab with Home / End', () => {
    expect(nextTabIndex(1, 'Home', 3)).toBe(0);
    expect(nextTabIndex(1, 'End', 3)).toBe(2);
  });

  it('handles a single tab and an empty tab list', () => {
    expect(nextTabIndex(0, 'ArrowRight', 1)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 1)).toBe(0);
    expect(nextTabIndex(0, 'End', 0)).toBe(0);
  });

  it('clamps an out-of-range current index before moving', () => {
    expect(nextTabIndex(99, 'ArrowRight', 3)).toBe(0);
    expect(nextTabIndex(-5, 'ArrowLeft', 3)).toBe(2);
  });
});
