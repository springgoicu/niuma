import { describe, expect, it } from 'bun:test';
import {
  DIRECTION,
  POSE,
  packState,
  quantizeCoord,
  unpackState,
  type MovePacket,
} from '@niuma/shared-types';
import { applyMove } from './movement';
import { Player } from './world';

/**
 * 服务端对叠加位的唯一职责是「保存与回传」（ADR-0018）。
 * 这里守的是那条防御线的形状：行走中只丢叫唤，跳跃必须放行——
 * 否则「边走边跳」在客户端看着正常，别人屏幕上却永远只有一个在滑步的人。
 */
function packet(state: number, x = 0, y = 0): MovePacket {
  return { id: 1, x: quantizeCoord(x), y: quantizeCoord(y), state };
}

function freshPlayer(): Player {
  const player = new Player();
  player.lastMoveAt = 0;
  return player;
}

describe('服务端叠加位准入', () => {
  it('行走中放行跳跃，姿态与 moving 保持原样', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Walk, true, false, true);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.pose).toBe(POSE.Walk);
    expect(player.moving).toBe(true);
    expect(player.jump).toBe(true);
    expect(player.emote).toBe(false);
    // 回传字节里也要带着 jump 位，远端才看得到
    expect(unpackState(player.state).jump).toBe(true);
  });

  it('行走中丢弃叫唤：没有行走张嘴帧，套上去就是滑步', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Walk, true, true, false);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.emote).toBe(false);
    expect(unpackState(player.state).emote).toBe(false);
  });

  it('moving 为真但姿态仍是 Idle 时同样按行走处理', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Idle, true, true, true);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.emote).toBe(false);
    expect(player.jump).toBe(true);
  });

  it('站定时叫唤与跳跃都放行', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Down, POSE.Idle, false, true, true);
    applyMove(player, packet(state), 1000);

    expect(player.emote).toBe(true);
    expect(player.jump).toBe(true);
  });

  it('行走中丢弃打招呼：没有行走挥手帧，套上去就是滑步抬手', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Walk, true, false, false, true);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.wave).toBe(false);
    expect(unpackState(player.state).wave).toBe(false);
  });

  it('站定与坐姿都放行打招呼，回传字节带 bit4', () => {
    for (const pose of [POSE.Idle, POSE.Sit, POSE.Lie]) {
      const player = freshPlayer();
      const state = packState(DIRECTION.Down, pose, false, false, false, true);
      applyMove(player, packet(state), 1000);

      expect(player.wave).toBe(true);
      expect(player.pose).toBe(pose);
      expect(unpackState(player.state)).toMatchObject({ pose, wave: true });
    }
  });

  it('打招呼与叫唤同时置位时互不影响：服务端只做准入，不做互斥', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Down, POSE.Idle, false, true, false, true);
    applyMove(player, packet(state), 1000);

    expect(player.emote).toBe(true);
    expect(player.wave).toBe(true);
  });
});
