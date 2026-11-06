import { describe, expect, it } from 'bun:test';
import { ATLAS_HEIGHT, ATLAS_WIDTH, CLIPS, COLUMNS, FRAME_SIZE, ROWS, phaseOfColumn, poseOfColumn } from '../layout';

const POSES = Object.keys(CLIPS) as Array<keyof typeof CLIPS>;

describe('图集布局契约', () => {
  it('每一列都被恰好一个动作覆盖，没有空洞也没有重叠', () => {
    // 有空洞 = 生成器画了没人播放的帧；重叠 = 两段动画抢同一列，必然错帧
    const owner = new Map<number, string>();
    for (const pose of POSES) {
      for (const column of new Set(CLIPS[pose].frames)) {
        expect(owner.has(column)).toBe(false);
        owner.set(column, pose);
      }
    }
    for (let column = 0; column < COLUMNS; column += 1) {
      expect(owner.has(column)).toBe(true);
      expect(poseOfColumn(column) as string).toBe(owner.get(column)!);
    }
  });

  it('所有列号都落在图集范围内', () => {
    for (const pose of POSES) {
      for (const column of CLIPS[pose].frames) {
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(COLUMNS);
      }
    }
  });

  it('帧序列与逐帧时长等长：少一个时长会读出 NaN，动画直接卡住', () => {
    for (const pose of POSES) {
      expect(CLIPS[pose].frameMs.length).toBe(CLIPS[pose].frames.length);
      expect(CLIPS[pose].frameMs.every((ms) => ms > 0)).toBe(true);
    }
  });

  it('循环起点不越界', () => {
    for (const pose of POSES) {
      expect(CLIPS[pose].loopFrom).toBeGreaterThanOrEqual(0);
      expect(CLIPS[pose].loopFrom).toBeLessThan(CLIPS[pose].frames.length);
    }
  });

  it('相邻两帧内容不同：连着两帧同图等于白播一帧', () => {
    for (const pose of POSES) {
      const { frames } = CLIPS[pose];
      for (let i = 1; i < frames.length; i += 1) {
        expect(frames[i]).not.toBe(frames[i - 1]);
      }
    }
  });

  it('phaseOfColumn 取该列在动作里的首次出现位置', () => {
    for (const pose of POSES) {
      for (const column of new Set(CLIPS[pose].frames)) {
        expect(phaseOfColumn(column)).toBe(CLIPS[pose].frames.indexOf(column));
      }
    }
  });

  it('一次性动作的长度与客户端播放窗口一致', () => {
    // 窗口是客户端选帧的硬边界：动画比窗口短会在末帧停顿，比窗口长会被硬切
    const expected: Record<string, number> = {
      jump: 440,
      emote: 440,
      sitEmote: 440,
      lieEmote: 440,
      // 挥手要多一拍「挥出」：三帧各 220ms，合计 660ms（ADR-0019）
      wave: 660,
      sitWave: 660,
      lieWave: 660,
    };
    for (const [pose, duration] of Object.entries(expected)) {
      const clip = CLIPS[pose as keyof typeof CLIPS];
      expect(clip.loop).toBe(false);
      expect(clip.frameMs.reduce((sum, ms) => sum + ms, 0)).toBe(duration);
    }
  });

  it('跳跃的腾空帧比蹲伏与落地都长：重心停在空中才读得出「跳」', () => {
    const { frameMs } = CLIPS.jump;
    expect(frameMs[1]).toBeGreaterThan(frameMs[0]!);
    expect(frameMs[1]).toBeGreaterThan(frameMs[2]!);
  });

  it('图集尺寸由帧尺寸与行列数推出，不额外留边', () => {
    expect(ATLAS_WIDTH).toBe(FRAME_SIZE * COLUMNS);
    expect(ATLAS_HEIGHT).toBe(FRAME_SIZE * ROWS);
    expect(Number.isInteger(ATLAS_WIDTH / FRAME_SIZE)).toBe(true);
  });
});
