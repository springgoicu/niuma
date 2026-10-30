import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, QUEUE_REJECT_REASON, type CharacterAppearance } from '@niuma/shared-types';
import { AdmissionController, type AdmissionConfig, type HelloPayload } from './controller';

const CONFIG: AdmissionConfig = {
  enabled: true,
  maxOnline: 20,
  minCapacity: 4,
  highWatermark: 0.85,
  lowWatermark: 0.65,
  capacityStep: 2,
  shrinkRatio: 0.75,
  stableMs: 30_000,
  shrinkIntervalMs: 10_000,
  breakerFactor: 2,
  breakerStrikes: 3,
  maxEgressKbps: 320,
  tickBudgetMs: 25,
  admitPerTick: 2,
  queueRatio: 1,
  queueMin: 4,
  queueMax: 50,
  queueMaxWaitMs: 60_000,
  sampleIntervalMs: 100,
};

const HEALTHY = { egressKbps: 60, online: 1, tickP95Ms: 2 };
const OVERLOAD = { egressKbps: 400, online: 20, tickP95Ms: 3 };

function payload(name: string, appearance: CharacterAppearance = DEFAULT_APPEARANCE.cow): HelloPayload {
  return { name, appearance };
}

describe('AdmissionController', () => {
  it('admits everyone immediately while the queue is disabled', () => {
    const controller = new AdmissionController({ ...CONFIG, enabled: false });
    controller.observe(0, OVERLOAD);
    expect(controller.decide(1, payload('a'), 999, 0).kind).toBe('admit');
    expect(controller.queueLength).toBe(0);
  });

  it('admits directly while every dimension is healthy', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    const decision = controller.decide(1, payload('a'), 1, 0);
    expect(decision).toEqual({ kind: 'admit', source: 'direct' });
  });

  it('queues after bandwidth overload and reports a usable snapshot', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    expect(controller.observe(500, OVERLOAD)).not.toBeNull();
    expect(controller.gateOpen).toBe(false);
    expect(controller.snapshot(20).capacity).toBe(15);

    const decision = controller.decide(7, payload('夜班实习生'), 20, 500);
    expect(decision.kind).toBe('queued');
    if (decision.kind !== 'queued') return;
    expect(decision.status.position).toBe(1);
    expect(decision.status.length).toBe(1);
    expect(decision.status.capacity).toBe(15);
    expect(decision.status.etaSec).toBeGreaterThan(0);
    expect(decision.status.utilizationPermille).toBe(1000);
  });

  it('rejects fast once the dynamic queue capacity is reached', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);

    const capacity = controller.queueCapacity();
    expect(capacity).toBe(15);
    for (let i = 1; i <= capacity; i += 1) {
      expect(controller.decide(i, payload(`p${i}`), 20, 500).kind).toBe('queued');
    }

    const overflow = controller.decide(999, payload('迟到的人'), 20, 500);
    expect(overflow).toEqual({ kind: 'reject', reason: QUEUE_REJECT_REASON.QueueFull });
    expect(controller.queueLength).toBe(capacity);
  });

  it('drains at most admitPerTick per tick, and nothing while the gate is shut', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);
    for (let i = 1; i <= 5; i += 1) controller.decide(i, payload(`p${i}`), 20, 500);

    expect(controller.drain(500, 5).admitted.length).toBe(0);

    controller.observe(2_000, HEALTHY);
    expect(controller.gateOpen).toBe(true);

    const first = controller.drain(2_000, 5);
    expect(first.admitted.length).toBe(2);
    expect(first.admitted.map((entry) => entry.wsId)).toEqual([1, 2]);

    const second = controller.drain(2_050, 5);
    expect(second.admitted.length).toBe(2);
    expect(controller.queueLength).toBe(1);
  });

  it('never lets a newcomer jump ahead of the queue', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);
    controller.decide(1, payload('先到的'), 20, 500);

    controller.observe(2_000, HEALTHY);
    expect(controller.gateOpen).toBe(true);
    expect(controller.decide(2, payload('想插队的'), 1, 2_000).kind).toBe('queued');
    expect(controller.queueLength).toBe(2);
  });

  it('expires waiters past the max wait instead of keeping them forever', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);
    controller.decide(3, payload('等太久的人'), 20, 500);

    const expired = controller.drain(60_501, 20).expired;
    expect(expired.length).toBe(1);
    expect(expired[0]?.wsId).toBe(3);
    expect(controller.queueLength).toBe(0);
  });

  it('releases the slot immediately when a waiter disconnects', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);
    controller.decide(4, payload('断线的人'), 20, 500);

    expect(controller.isQueued(4)).toBe(true);
    expect(controller.drop(4)).toBe(true);
    expect(controller.isQueued(4)).toBe(false);
    expect(controller.drop(4)).toBe(false);
    expect(controller.queueLength).toBe(0);
  });

  it('pushes position snapshots at most once per second, in FIFO order', () => {
    const controller = new AdmissionController(CONFIG);
    controller.observe(0, HEALTHY);
    controller.observe(500, OVERLOAD);
    for (let i = 1; i <= 3; i += 1) controller.decide(i, payload(`p${i}`), 20, 500);

    const first = controller.statuses(1_000, 20);
    expect(first.map((entry) => [entry.wsId, entry.status.position])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);

    expect(controller.statuses(1_200, 20).length).toBe(0);
    const next = controller.statuses(2_000, 20);
    expect(next.length).toBe(3);
    expect(next[2]?.status.length).toBe(3);
  });
});
