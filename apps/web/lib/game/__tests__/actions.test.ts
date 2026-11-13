import { describe, expect, it } from 'bun:test';
import { POSE } from '@niuma/shared-types';
import { actionPresentation, resolveInteraction, type InteractionState } from '../actions';

const standing: InteractionState = {
  pose: POSE.Idle,
  seated: false,
  seatKind: null,
  moving: false,
  seatAvailable: false,
  bedAvailable: false,
};
const standingNearSeat: InteractionState = { ...standing, seatAvailable: true };
const standingNearBed: InteractionState = { ...standing, bedAvailable: true };
const walking: InteractionState = { ...standing, pose: POSE.Walk, moving: true };
const walkingNearSeat: InteractionState = { ...walking, seatAvailable: true };
const walkingNearBed: InteractionState = { ...walking, bedAvailable: true };
const groundSitting: InteractionState = { ...standing, pose: POSE.Sit };
const seatSitting: InteractionState = { ...groundSitting, seated: true, seatKind: 'stool' };
const lying: InteractionState = { ...standing, pose: POSE.Lie };
const bedLying: InteractionState = { ...lying, seated: true, seatKind: 'bed' };
const seatSittingNearSeat: InteractionState = { ...seatSitting, seatAvailable: true };

describe('坐下 / 起身开关', () => {
  it('站立按 Z：附近没有空位就地坐下', () => {
    expect(resolveInteraction('sit', standing)).toEqual({ kind: 'sit-ground' });
  });

  it('站立按 Z：附近有空位优先入座', () => {
    expect(resolveInteraction('sit', standingNearSeat)).toEqual({ kind: 'sit-seat' });
  });

  it('地面坐姿再按 Z：起身', () => {
    expect(resolveInteraction('sit', groundSitting)).toEqual({ kind: 'stand' });
  });

  it('座位坐姿再按 Z：起身并释放座位', () => {
    expect(resolveInteraction('sit', seatSitting)).toEqual({ kind: 'stand' });
  });

  it('躺姿按 Z：直接换成坐，不需要先起身', () => {
    expect(resolveInteraction('sit', lying)).toEqual({ kind: 'sit-ground' });
  });

  it('行走中按 Z 且无空位：给出站定提示，不闪一帧坐姿', () => {
    const intent = resolveInteraction('sit', walking);
    expect(intent.kind).toBe('blocked');
    if (intent.kind === 'blocked') expect(intent.hint).toContain('站定');
  });

  it('行走中经过空位按 Z：仍然吸附入座', () => {
    expect(resolveInteraction('sit', walkingNearSeat)).toEqual({ kind: 'sit-seat' });
  });

  it('床边按 Z：提示床上只能躺，不就地坐下', () => {
    const intent = resolveInteraction('sit', standingNearBed);
    expect(intent.kind).toBe('blocked');
    if (intent.kind === 'blocked') expect(intent.hint).toContain('按 X');
  });

  it('躺在床位上按 Z：不改姿态，提示按 X 起身', () => {
    const intent = resolveInteraction('sit', bedLying);
    expect(intent.kind).toBe('blocked');
    if (intent.kind === 'blocked') expect(intent.hint).toContain('起身');
  });
});

describe('躺平 / 起身开关', () => {
  it('站立按 X：躺下', () => {
    expect(resolveInteraction('lie', standing)).toEqual({ kind: 'lie' });
  });

  it('地面坐姿按 X：从坐直接躺下', () => {
    expect(resolveInteraction('lie', groundSitting)).toEqual({ kind: 'lie' });
  });

  it('躺姿再按 X：起身', () => {
    expect(resolveInteraction('lie', lying)).toEqual({ kind: 'stand' });
  });

  it('床边按 X：吸附上床', () => {
    expect(resolveInteraction('lie', standingNearBed)).toEqual({ kind: 'lie-bed' });
  });

  it('行走中经过空床按 X：同样吸附上床', () => {
    expect(resolveInteraction('lie', walkingNearBed)).toEqual({ kind: 'lie-bed' });
  });

  it('坐在凳子上按 X：先起身，给出提示', () => {
    const intent = resolveInteraction('lie', seatSitting);
    expect(intent.kind).toBe('blocked');
    if (intent.kind === 'blocked') expect(intent.hint).toContain('起身');
  });

  it('躺在床位上再按 X：起身', () => {
    expect(resolveInteraction('lie', bedLying)).toEqual({ kind: 'stand' });
  });

  it('行走中按 X 且附近没有床：给出站定提示', () => {
    expect(resolveInteraction('lie', walking).kind).toBe('blocked');
  });
});

describe('跳与叠加动作', () => {
  it('跳跃在任何姿态下都接：先起身再跳', () => {
    for (const state of [standing, walking, groundSitting, seatSitting, lying, bedLying]) {
      expect(resolveInteraction('jump', state)).toEqual({ kind: 'jump' });
    }
  });

  it('发泄在任何姿态下都出招：姿态只决定播哪一套帧', () => {
    // 站 / 走 / 坐 / 躺 / 床上躺着都能按 E —— 行走中由客户端先落回站姿再出招
    for (const state of [standing, walking, groundSitting, seatSitting, lying, bedLying]) {
      expect(resolveInteraction('vent', state)).toEqual({ kind: 'vent' });
    }
  });

  it('行走中打招呼被拦下并给出提示', () => {
    expect(resolveInteraction('wave', walking).kind).toBe('blocked');
  });

  it('站定或坐着打招呼都可用', () => {
    expect(resolveInteraction('wave', standing)).toEqual({ kind: 'wave' });
    expect(resolveInteraction('wave', seatSitting)).toEqual({ kind: 'wave' });
  });
});

describe('互动与按钮表现', () => {
  it('F 互动在任何姿态下都交给 session 判距离', () => {
    expect(resolveInteraction('interact', standing)).toEqual({ kind: 'interact' });
    expect(resolveInteraction('interact', bedLying)).toEqual({ kind: 'interact' });
  });

  it('坐着时坐下按钮高亮并改文案为起身', () => {
    expect(actionPresentation('sit', groundSitting)).toMatchObject({ active: true, label: '起身' });
    expect(actionPresentation('sit', seatSitting)).toMatchObject({ active: true, label: '起身' });
  });

  it('站着时坐下按钮不高亮', () => {
    expect(actionPresentation('sit', standing)).toMatchObject({ active: false, label: '坐下' });
  });

  it('躺在床位上：坐下按钮降级，躺平按钮高亮', () => {
    expect(actionPresentation('sit', bedLying)).toMatchObject({ active: false, unavailable: true });
    expect(actionPresentation('lie', bedLying)).toMatchObject({ active: true, label: '起身', unavailable: false });
  });

  it('坐在凳子上：躺平按钮降级，坐下按钮可用', () => {
    expect(actionPresentation('lie', seatSitting).unavailable).toBe(true);
    expect(actionPresentation('sit', seatSitting).unavailable).toBe(false);
    expect(actionPresentation('lie', groundSitting).unavailable).toBe(false);
  });

  it('行走中打招呼按钮显示不可用，发泄仍然可用', () => {
    expect(actionPresentation('wave', walking).unavailable).toBe(true);
    expect(actionPresentation('wave', standing).unavailable).toBe(false);
    // 行走中按 E 是「打断移动直接出招」，所以按钮永不降级
    expect(actionPresentation('vent', walking).unavailable).toBe(false);
  });

  it('发泄、跳跃与互动是一次性动作，不进入高亮态', () => {
    expect(actionPresentation('vent', groundSitting).active).toBe(false);
    expect(actionPresentation('jump', standing).active).toBe(false);
    expect(actionPresentation('interact', standing)).toEqual({ active: false, unavailable: false });
  });

  it('坐上座位后依然可以在座位上发泄', () => {
    expect(actionPresentation('vent', seatSittingNearSeat).unavailable).toBe(false);
  });
});
