'use client';

import { POSE, type Pose, type SeatKind } from '@niuma/shared-types';
import { HINT } from './hint-copy';
import type { ActionKey } from './input';

/**
 * 交互裁决：回答「这个动作在当前姿态下应该发生什么」。
 *
 * 纯函数，不碰 Motion / 网络 / 音频，`GameSession` 只负责执行返回的意图。
 * 坐 / 躺是开关而不是单向姿势，所以判定必须能同时看到姿态、座位、床位与行走状态。
 */
export interface InteractionState {
  /** 当前基础姿态 */
  pose: Pose;
  /** 已坐在 / 躺在座位锚点上（localSeat !== 0） */
  seated: boolean;
  /** 当前座位种类；未入座时为 null。床位只接受躺姿 */
  seatKind: SeatKind | null;
  /** 正在行走（有实际位移） */
  moving: boolean;
  /** 附近有空闲的坐位（椅子 / 凳子 / 沙发 / 马桶，不含床） */
  seatAvailable: boolean;
  /** 附近有空闲的床位 */
  bedAvailable: boolean;
}

export type InteractionIntent =
  /** 吸附到附近空位并坐下 */
  | { kind: 'sit-seat' }
  /** 就地坐下 */
  | { kind: 'sit-ground' }
  /** 吸附到附近的空床并躺下 */
  | { kind: 'lie-bed' }
  /** 就地躺下 */
  | { kind: 'lie' }
  /** 起身：释放座位并回到站立 */
  | { kind: 'stand' }
  | { kind: 'jump' }
  /**
   * 发泄：出招动作 + 服务端裁决的命中。
   *
   * 任何姿态、任何速度下都可用——行走中按 E 是「打断移动直接出招」，
   * 客户端会自己把姿态落回站姿并锁住位移，不存在「边走边撞」的滑步降级（ADR-0051）。
   */
  | { kind: 'vent' }
  | { kind: 'wave' }
  /** 与最近的可互动设施（售货机 / 饮水机 / 咖啡机）互动 */
  | { kind: 'interact' }
  | { kind: 'vehicle' }
  | { kind: 'cpr' }
  | { kind: 'gig' }
  /** 当前状态下不可用：提示文案交给 session 走瞬时 hint 通道 */
  | { kind: 'blocked'; hint: string };

/** 站定：没有位移且不在走路循环里，只有这时才播叫唤 / 挥手动画 */
function isStationary(state: Pick<InteractionState, 'pose' | 'moving'>): boolean {
  return !state.moving && state.pose !== POSE.Walk;
}

/** 被拦下的原因只写一份：点击提示与按钮 title 共用同一句文案；带按键的文案见 hint-copy */
const HINT_SIT_WHILE_WALKING = '站定后才能坐下';
const HINT_LIE_WHILE_WALKING = '站定后才能躺平';
const HINT_WAVE_WHILE_WALKING = '站定后才能打招呼';

/** 按钮表现只需要姿态与座位种类，不必知道座位表 */
type PresentationState = Pick<InteractionState, 'pose' | 'seated' | 'seatKind' | 'moving'>;

export function resolveInteraction(action: ActionKey, state: InteractionState): InteractionIntent {
  switch (action) {
    case 'sit': {
      // 床位上只能躺：按 Z 不改姿态，只给出正确按键
      if (state.seated && state.seatKind === 'bed') return { kind: 'blocked', hint: HINT.sitOnBed };
      // 已经坐着（座位或地面）：再按 Z 就是起身
      if (state.seated || state.pose === POSE.Sit) return { kind: 'stand' };
      // 旁边只有床时不要就地坐下：那会让人以为「坐不上床」是 bug
      if (!state.seatAvailable && state.bedAvailable) return { kind: 'blocked', hint: HINT.bedOnly };
      // 旁边有空位时允许边走边坐：吸附到锚点是瞬时的，不存在滑步
      if (state.seatAvailable) return { kind: 'sit-seat' };
      // 站着走的时候就地坐下会闪一帧坐姿再被走路覆盖
      if (!isStationary(state)) return { kind: 'blocked', hint: HINT_SIT_WHILE_WALKING };
      return { kind: 'sit-ground' };
    }
    case 'lie': {
      if (state.seated) {
        // 已经躺在床位上：再按 X 起身；坐在凳子 / 椅子上则先起身
        if (state.seatKind === 'bed') return { kind: 'stand' };
        return { kind: 'blocked', hint: HINT.lieOnSeat };
      }
      if (state.pose === POSE.Lie) return { kind: 'stand' };
      // 空床优先吸附，与「坐着空位」同一条即时吸附路径
      if (state.bedAvailable) return { kind: 'lie-bed' };
      if (!isStationary(state)) return { kind: 'blocked', hint: HINT_LIE_WHILE_WALKING };
      return { kind: 'lie' };
    }
    case 'jump':
      // 跳跃是位移动作：坐 / 躺 / 行走中都能接，由 session 先起身再跳
      return { kind: 'jump' };
    case 'vent':
      // 发泄是服务端权威的互动：这里只表达意图，命中与否交给服务端 Tick
      return { kind: 'vent' };
    case 'wave':
      if (!isStationary(state)) return { kind: 'blocked', hint: HINT_WAVE_WHILE_WALKING };
      return { kind: 'wave' };
    case 'interact':
      // 附近没有设施时由 session 走瞬时提示，不在这里判距离
      return { kind: 'interact' };
    case 'vehicle':
      return { kind: 'vehicle' };
    case 'cpr':
      return { kind: 'cpr' };
    case 'gig':
      return { kind: 'gig' };
  }
}

export interface ActionPresentation {
  /** 当前姿态已经是该动作的结果（坐下 ↔ 起身） */
  active: boolean;
  /** 降级显示但仍可点击：点击走 blocked 提示，不做真 disabled */
  unavailable: boolean;
  /** 仅开关类动作有随状态变化的文案 */
  label?: string;
  /** 降级原因：按钮 title 与无障碍描述用，和点击时的提示同一句 */
  reason?: string;
}

/**
 * 按钮表现：桌面动作条与触屏动作盘共用，避免两套组件各自判断状态。
 * 一次性动作（叫唤 / 跳 / 互动）永远不进高亮态。
 */
export function actionPresentation(action: ActionKey, state: PresentationState): ActionPresentation {
  switch (action) {
    case 'sit': {
      const active = state.pose === POSE.Sit;
      // 躺在床位上时坐下按钮降级：床边只有「X 起身」这一条路
      const unavailable = state.seated && state.seatKind === 'bed';
      return {
        active,
        unavailable,
        label: active ? '起身' : '坐下',
        reason: unavailable ? HINT.sitOnBed : undefined,
      };
    }
    case 'lie': {
      const active = state.pose === POSE.Lie;
      // 座位上的躺姿只有床位合法：坐在凳子上时按钮降级，但点击仍走 blocked 提示
      const unavailable = state.seated && state.seatKind !== 'bed';
      return {
        active,
        unavailable,
        label: active ? '起身' : '躺平',
        reason: unavailable ? HINT.lieOnSeat : undefined,
      };
    }
    case 'interact':
      return { active: false, unavailable: false };
    case 'vent':
      // 行走中也能出招（打断移动），所以永不降级
      return { active: false, unavailable: false };
    case 'wave': {
      // 行走中按了也没反应，提前显示不可用
      const unavailable = !isStationary(state);
      return { active: false, unavailable, reason: unavailable ? HINT_WAVE_WHILE_WALKING : undefined };
    }
    case 'jump':
      return { active: false, unavailable: false };
    case 'vehicle':
    case 'cpr':
    case 'gig':
      return { active: false, unavailable: false };
  }
}
