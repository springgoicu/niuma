import { describe, expect, it } from 'bun:test';
import { POSE } from '@niuma/shared-types';
import { buildClipTracks, buildOverlayTracks, overlayTrackFor } from '../clip';

const tracks = buildClipTracks();
const overlays = buildOverlayTracks(tracks);

describe('叠加动作选帧', () => {
  it('没有叠加动作时回落到姿态轨：四态都不被覆盖', () => {
    for (const pose of [POSE.Idle, POSE.Walk, POSE.Sit, POSE.Lie]) {
      expect(overlayTrackFor(overlays, pose, false, false, false)).toBeNull();
    }
  });

  it('叫唤按姿态分三条轨：站 / 坐 / 躺各播各的', () => {
    expect(overlayTrackFor(overlays, POSE.Idle, true, false, false)).toBe(tracks.emote!);
    expect(overlayTrackFor(overlays, POSE.Sit, true, false, false)).toBe(tracks.sitEmote!);
    expect(overlayTrackFor(overlays, POSE.Lie, true, false, false)).toBe(tracks.lieEmote!);
  });

  it('行走中不接叫唤：图集没有行走张嘴帧，套上去就是滑步', () => {
    expect(overlayTrackFor(overlays, POSE.Walk, true, false, false)).toBeNull();
  });

  it('行走中接跳跃：位移不中断，跳跃帧临时替换脚步', () => {
    expect(overlayTrackFor(overlays, POSE.Walk, false, true, false)).toBe(tracks.jump!);
    expect(overlayTrackFor(overlays, POSE.Walk, true, true, false)).toBe(tracks.jump!);
  });

  it('跳优先于叫唤：两个位同时为真也只画跳', () => {
    expect(overlayTrackFor(overlays, POSE.Idle, true, true, false)).toBe(tracks.jump!);
    expect(overlayTrackFor(overlays, POSE.Sit, true, true, false)).toBe(tracks.jump!);
  });

  it('打招呼按姿态分三条轨：站 / 坐 / 躺各播各的', () => {
    expect(overlayTrackFor(overlays, POSE.Idle, false, false, true)).toBe(tracks.wave!);
    expect(overlayTrackFor(overlays, POSE.Sit, false, false, true)).toBe(tracks.sitWave!);
    expect(overlayTrackFor(overlays, POSE.Lie, false, false, true)).toBe(tracks.lieWave!);
  });

  it('行走中不接打招呼：图集没有行走挥手帧，套上去就是滑步抬手', () => {
    expect(overlayTrackFor(overlays, POSE.Walk, false, false, true)).toBeNull();
    expect(overlayTrackFor(overlays, POSE.Walk, true, false, true)).toBeNull();
  });

  it('跳 > 打招呼 > 叫唤：多个位同时为真时只画最高优先级那条', () => {
    expect(overlayTrackFor(overlays, POSE.Idle, false, true, true)).toBe(tracks.jump!);
    expect(overlayTrackFor(overlays, POSE.Idle, true, false, true)).toBe(tracks.wave!);
  });

  it('叫唤 / 打招呼与跳都是一次性动作：播完钳在末帧，不会循环回第一帧', () => {
    for (const track of [
      tracks.emote!,
      tracks.sitEmote!,
      tracks.lieEmote!,
      tracks.wave!,
      tracks.sitWave!,
      tracks.lieWave!,
      tracks.jump!,
    ]) {
      expect(track.loop).toBe(false);
    }
  });

  it('播放窗口覆盖图集里的实际长度', () => {
    // 客户端用这几个毫秒数决定何时清位：短于动画会在末帧硬切
    expect(overlays.emoteMs).toBeGreaterThanOrEqual(tracks.emote!.durationMs);
    expect(overlays.emoteMs).toBeGreaterThanOrEqual(tracks.lieEmote!.durationMs);
    expect(overlays.waveMs).toBeGreaterThanOrEqual(tracks.wave!.durationMs);
    expect(overlays.waveMs).toBeGreaterThanOrEqual(tracks.lieWave!.durationMs);
    // 挥手是三拍 660ms：窗口必须大于叫唤那一档，否则第三拍会被掐掉
    expect(overlays.waveMs).toBeGreaterThan(overlays.emoteMs);
    expect(overlays.jumpMs).toBeGreaterThanOrEqual(tracks.jump!.durationMs);
  });
});
