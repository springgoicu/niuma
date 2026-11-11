import { describe, expect, it } from 'bun:test';
import { POSE } from '@niuma/shared-types';
import {
  PICK_HALF_WIDTH,
  PICK_TOP,
  formatOnline,
  pickCharacter,
  poseLabel,
  seatLabel,
} from '../badge';

describe('online duration formatting', () => {
  it('pads hours, minutes and seconds', () => {
    expect(formatOnline(0)).toBe('00:00:00');
    expect(formatOnline(59)).toBe('00:00:59');
    expect(formatOnline(3661)).toBe('01:01:01');
    expect(formatOnline(360000)).toBe('100:00:00');
  });

  it('clamps negatives and floors fractions', () => {
    expect(formatOnline(-30)).toBe('00:00:00');
    expect(formatOnline(61.9)).toBe('00:01:01');
  });

  it('shows a placeholder instead of pretending to be online', () => {
    expect(formatOnline(null)).toBe('--:--');
    expect(formatOnline(undefined)).toBe('--:--');
    expect(formatOnline(Number.NaN)).toBe('--:--');
    expect(formatOnline(Number.POSITIVE_INFINITY)).toBe('--:--');
  });
});

describe('badge labels', () => {
  it('names the current pose, splitting seated and ground sitting', () => {
    expect(poseLabel(POSE.Idle, false, false)).toBe('在岗待命');
    expect(poseLabel(POSE.Walk, false, false)).toBe('搬砖中');
    expect(poseLabel(POSE.Idle, true, false)).toBe('搬砖中');
    expect(poseLabel(POSE.Sit, false, true)).toBe('入座摸鱼');
    expect(poseLabel(POSE.Sit, false, false)).toBe('席地而坐');
    expect(poseLabel(POSE.Lie, false, true)).toBe('躺平中');
  });

  it('names the seat kind', () => {
    expect(seatLabel(null)).toBe('未入座');
    expect(seatLabel('chair')).toBe('工位椅');
    expect(seatLabel('stool')).toBe('凳子');
    expect(seatLabel('sofa')).toBe('沙发');
    expect(seatLabel('bed')).toBe('床位');
    expect(seatLabel('toilet')).toBe('马桶');
  });
});

describe('character picking', () => {
  const candidates = [
    { id: 1, x: 100, y: 100 },
    { id: 2, x: 150, y: 100 },
  ];

  it('hits the box around the feet and nameplate', () => {
    expect(pickCharacter(candidates, 100, 100)).toBe(1);
    expect(pickCharacter(candidates, 100 + PICK_HALF_WIDTH, 100)).toBe(1);
    expect(pickCharacter(candidates, 100, 100 + PICK_TOP)).toBe(1);
  });

  it('misses outside the box', () => {
    expect(pickCharacter(candidates, 100 + PICK_HALF_WIDTH + 1, 100)).toBeNull();
    expect(pickCharacter(candidates, 100, 100 + PICK_TOP - 1)).toBeNull();
    expect(pickCharacter(candidates, 100, 200)).toBeNull();
  });

  it('prefers the nearest candidate when boxes overlap', () => {
    const overlapping = [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 110, y: 100 },
    ];
    expect(pickCharacter(overlapping, 108, 100)).toBe(2);
    expect(pickCharacter(overlapping, 102, 100)).toBe(1);
  });

  it('returns null for empty input and non-finite coordinates', () => {
    expect(pickCharacter([], 0, 0)).toBeNull();
    expect(pickCharacter(candidates, Number.NaN, 100)).toBeNull();
    expect(pickCharacter([{ id: 1, x: Number.NaN, y: 100 }], 100, 100)).toBeNull();
  });
});
