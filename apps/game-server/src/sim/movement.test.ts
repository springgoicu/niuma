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
 * 服务端对叠加位的职责是「保存与回传 + 一处准入」（ADR-0051）。
 * 这里守的是那条防御线的形状：行走中只丢打招呼，发泄与跳必须放行——
 * 否则「边走边跳」在客户端看着正常，别人屏幕上却永远只有一个在滑步的人；
 * 发泄被吃掉则会出现「按了 E 只出声、不出招」的死键。
 */
function packet(state: number, x = 0, y = 0): MovePacket {
  return { id: 1, x: quantizeCoord(x), y: quantizeCoord(y), state };
}

function freshPlayer(): Player {
  const player = new Player();
  player.lastMoveAt = 0;
  return player;
}

/**
 * 去脏判定的基准是「上一次真正广播出去的三元组」。
 * 这里手动回写一次，等于模拟 `runTick` 已经把这一帧发出去。
 */
function synced(player: Player): void {
  player.lastBroadcastQx = quantizeCoord(player.x);
  player.lastBroadcastQy = quantizeCoord(player.y);
  player.lastBroadcastState = player.state;
  player.dirty = false;
}

/** 已经站在广场上的玩家：坐标先落位，避免首次移动被速度窗口截断而干扰判定 */
function playerAt(x: number, y: number): Player {
  const player = new Player();
  player.x = x;
  player.y = y;
  player.lastMoveAt = 0;
  return player;
}

describe('空闲去脏', () => {
  it('坐标与 state 都没变的重复包不置 dirty', () => {
    const player = playerAt(4096, 4096);
    const state = packState(DIRECTION.Down, POSE.Sit, false);
    applyMove(player, packet(state, 4096, 4096), 1000);
    synced(player);

    // 工位上坐着：客户端仍然 20Hz 发包，但每一包对别人都是同一份字节
    for (let i = 0; i < 5; i += 1) {
      applyMove(player, packet(state, 4096, 4096), 1050 + i * 50);
      expect(player.dirty).toBe(false);
    }
  });

  it('转身就置 dirty：朝向变了，别人看得见', () => {
    const player = playerAt(4096, 4096);
    applyMove(player, packet(packState(DIRECTION.Down, POSE.Sit, false), 4096, 4096), 1000);
    synced(player);

    applyMove(player, packet(packState(DIRECTION.Left, POSE.Sit, false), 4096, 4096), 1050);
    expect(player.dirty).toBe(true);
  });

  it('走了一格就置 dirty', () => {
    const player = playerAt(4096, 4096);
    applyMove(player, packet(packState(DIRECTION.Right, POSE.Walk, true), 4096, 4096), 1000);
    synced(player);

    applyMove(player, packet(packState(DIRECTION.Right, POSE.Walk, true), 4104, 4096), 1050);
    expect(player.dirty).toBe(true);
  });

  it('发泄结束时必须置 dirty，否则远端会一直播下去', () => {
    const player = playerAt(4096, 4096);
    applyMove(player, packet(packState(DIRECTION.Down, POSE.Idle, false, true), 4096, 4096), 1000);
    synced(player);

    // 播放窗口结束，客户端把 bit6 降下来 —— 这是唯一一次能让远端停下的机会
    applyMove(player, packet(packState(DIRECTION.Down, POSE.Idle, false, false), 4096, 4096), 1500);
    expect(player.dirty).toBe(true);
    expect(unpackState(player.state).vent).toBe(false);
  });
});

describe('速度窗口封顶', () => {
  it('隔了很久才发一包也不能瞬移', () => {
    const player = freshPlayer();
    applyMove(player, packet(packState(DIRECTION.Right, POSE.Walk, true), 4096, 4096), 1000);

    // 站着不动 10 秒后声称自己已经在 200px 外：窗口不封顶时 allowed 会到 2000px
    const result = applyMove(player, packet(packState(DIRECTION.Right, POSE.Walk, true), 4296, 4096), 11_000);
    expect(result.clamped).toBe(true);
    expect(player.x).toBeLessThan(4296);
  });
});

describe('服务端叠加位准入', () => {
  it('行走中放行跳跃，姿态与 moving 保持原样', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Walk, true, false, true);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.pose).toBe(POSE.Walk);
    expect(player.moving).toBe(true);
    expect(player.jump).toBe(true);
    expect(player.vent).toBe(false);
    // 回传字节里也要带着 jump 位，远端才看得到
    expect(unpackState(player.state).jump).toBe(true);
  });

  it('行走中放行发泄：这一包就是「边走边按 E」的第一包，吃掉就再也打不出招', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Walk, true, true, false);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.vent).toBe(true);
    // 位进 set 就置一次边沿标记，Tick 里的结算只认它
    expect(player.ventPending).toBe(true);
    expect(unpackState(player.state).vent).toBe(true);
  });

  it('moving 为真但姿态仍是 Idle 时同样放行发泄', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Right, POSE.Idle, true, true, true);
    applyMove(player, packet(state, 8, 0), 1000);

    expect(player.vent).toBe(true);
    expect(player.jump).toBe(true);
  });

  it('站定时发泄与跳跃都放行', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Down, POSE.Idle, false, true, true);
    applyMove(player, packet(state), 1000);

    expect(player.vent).toBe(true);
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

  it('打招呼与发泄同时置位时互不影响：服务端只做准入，不做互斥', () => {
    const player = freshPlayer();
    const state = packState(DIRECTION.Down, POSE.Idle, false, true, false, true);
    applyMove(player, packet(state), 1000);

    expect(player.vent).toBe(true);
    expect(player.wave).toBe(true);
  });
});
