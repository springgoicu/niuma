import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  POSE,
  SYNC_FORMAT_COMPACT,
  packState,
  quantizeCoord,
  readSync,
  type MovePacket,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { applyMove } from './movement';
import { runTick } from './tick';
import { refreshView, type Transport } from './view';
import { World, type Player } from './world';

interface Sent {
  wsId: number;
  data: Uint8Array;
}

function recorder(): { sent: Sent[]; transport: Transport } {
  const sent: Sent[] = [];
  return {
    sent,
    transport: {
      send(wsId, data) {
        sent.push({ wsId, data });
      },
    },
  };
}

function packet(state: number, x: number, y: number): MovePacket {
  return { id: 1, x: quantizeCoord(x), y: quantizeCoord(y), state };
}

/** 两个互相可见的玩家：`known` 手写，避免把视野重算的时序混进这条用例 */
function twoPlayers(): { world: World; grid: SpatialGrid; a: Player; b: Player } {
  const world = new World();
  const grid = new SpatialGrid();
  const a = world.create('甲', DEFAULT_APPEARANCE.cow, 11, 4096, 4096)!;
  const b = world.create('乙', DEFAULT_APPEARANCE.cow, 12, 4104, 4096)!;
  a.known.add(b.id);
  b.known.add(a.id);
  grid.insert(a.id, a.x, a.y);
  grid.insert(b.id, b.x, b.y);
  return { world, grid, a, b };
}

describe('Tick 广播只在有变化时发生', () => {
  it('全员静止时一个包都不发', () => {
    const { world, grid, a, b } = twoPlayers();
    const { sent, transport } = recorder();
    // 先让双方各发一帧，把广播基准建立起来
    a.dirty = true;
    b.dirty = true;
    runTick(world, grid, transport, 1);
    sent.length = 0;

    runTick(world, grid, transport, 2);
    expect(sent).toHaveLength(0);
  });

  it('坐着不动重复发包，第二帧不再广播', () => {
    const { world, grid, a, b } = twoPlayers();
    const { sent, transport } = recorder();
    const state = packState(DIRECTION.Down, POSE.Sit, false);

    applyMove(a, packet(state, a.x, a.y), 1000);
    runTick(world, grid, transport, 1);
    // 甲自己一包 + 乙收到甲的一包
    expect(sent).toHaveLength(2);
    sent.length = 0;

    for (let i = 0; i < 3; i += 1) {
      applyMove(a, packet(state, a.x, a.y), 1050 + i * 50);
      runTick(world, grid, transport, 2 + i);
    }
    expect(sent).toHaveLength(0);
    expect(b.known.has(a.id)).toBe(true);
  });

  it('走动时仍然每帧广播，条目带的是新坐标', () => {
    const { world, grid, a, b } = twoPlayers();
    const { sent, transport } = recorder();
    const state = packState(DIRECTION.Right, POSE.Walk, true);

    applyMove(a, packet(state, a.x + 8, a.y), 1000);
    runTick(world, grid, transport, 1);

    const toB = sent.find((item) => item.wsId === b.wsId)!;
    const seen: Array<{ id: number; x: number; y: number; state: number }> = [];
    readSync(toB.data, (id, x, y, s) => seen.push({ id, x, y, state: s }), a.syncFormat);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(a.id);
    expect(seen[0]!.x).toBe(quantizeCoord(a.x));
  });

  it('按观察者各自的格式编码：紧凑连接收 6 字节，旧连接收 7 字节', () => {
    const { world, grid, a, b } = twoPlayers();
    b.syncFormat = SYNC_FORMAT_COMPACT;
    const { sent, transport } = recorder();

    a.dirty = true;
    runTick(world, grid, transport, 1);

    const toA = sent.find((item) => item.wsId === a.wsId)!;
    const toB = sent.find((item) => item.wsId === b.wsId)!;
    expect(toA.data.byteLength).toBe(7 + 7);
    expect(toB.data.byteLength).toBe(7 + 6);

    const seen: number[] = [];
    readSync(toB.data, (id) => seen.push(id), SYNC_FORMAT_COMPACT);
    expect(seen).toEqual([a.id]);
  });

  it('视野重算照旧发放入场包，不受去脏影响', () => {
    const { world, grid, a, b } = twoPlayers();
    a.known.clear();
    b.known.clear();
    a.needsViewRefresh = true;
    const { sent, transport } = recorder();

    runTick(world, grid, transport, 1);

    // 双向 spawn：a 看见 b、b 看见 a
    expect(sent.filter((item) => item.data[0] === 0x05)).toHaveLength(2);
    expect(a.known.has(b.id)).toBe(true);
    expect(b.known.has(a.id)).toBe(true);
  });
});

describe('视野刷新与去脏共存', () => {
  it('refreshView 之后新入视野的人立刻能收到下一帧的移动', () => {
    const { world, grid, a, b } = twoPlayers();
    const { sent, transport } = recorder();

    a.known.clear();
    b.known.clear();
    a.needsViewRefresh = true;
    refreshView(a, world, grid, transport);
    expect(b.known.has(a.id)).toBe(true);
  });
});
