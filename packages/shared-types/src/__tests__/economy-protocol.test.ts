import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  ECONOMY_EXTENSION_MAGIC,
  ITEM_SKUS,
  OpCode,
  P2P_GAME_TYPE,
  P2P_MATCH_PHASE,
  P2P_MAX_WAGER,
  WALLET_REASON,
  clampCoins,
  decodeHello,
  decodeItemEffect,
  decodeP2PInvite,
  decodeP2PInviteNotify,
  decodeP2PInviteResult,
  decodeP2PMatch,
  decodeP2PRespond,
  decodeShopBuy,
  decodeTipBroadcast,
  decodeTipRequest,
  decodeUseItem,
  decodeWalletSync,
  effectiveVentCooldownMs,
  encodeHello,
  encodeItemEffect,
  encodeP2PInvite,
  encodeP2PInviteNotify,
  encodeP2PInviteResult,
  encodeP2PMatch,
  encodeP2PRespond,
  encodeShopBuy,
  encodeTipBroadcast,
  encodeTipRequest,
  encodeUseItem,
  encodeWalletSync,
  readEconomySegment,
  sanitizeEconomyProfile,
  statUpgradePrice,
  ventCooldownMs,
} from '../index';

const PROFILE = sanitizeEconomyProfile({
  coins: 420,
  stats: { atkSpeedLv: 3, workEffLv: 1, critLv: 0, armorLv: 2 },
  inventory: { ice_americano: 4, slack_shield: 1 },
  houseTier: 2,
});

describe('牛马币经济段', () => {
  it('HELLO 尾部经济段往返，且不影响既有字段', () => {
    const decoded = decodeHello(
      encodeHello(
        '牛马',
        DEFAULT_APPEARANCE.cow,
        undefined,
        '摸鱼中',
        0,
        undefined,
        undefined,
        undefined,
        PROFILE,
      ),
    );
    expect(decoded.name).toBe('牛马');
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.economy).toEqual(PROFILE);
  });

  it('没有经济档案时一个字节都不多写，旧服务端照常解码', () => {
    const legacy = encodeHello('牛', DEFAULT_APPEARANCE.cow);
    expect(decodeHello(legacy).economy).toBeUndefined();
    expect(decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow)).resume).toBeUndefined();
  });

  it('经济段截断或魔数不符时返回 undefined，不越界读取', () => {
    const packet = encodeHello(
      '牛',
      DEFAULT_APPEARANCE.cow,
      undefined,
      '',
      0,
      undefined,
      undefined,
      undefined,
      PROFILE,
    );
    // 载荷 = 10 字节固定头 + 2 种道具 × 3 字节
    const economyAt = packet.byteLength - (2 + 10 + 6);
    expect(packet[economyAt]).toBe(ECONOMY_EXTENSION_MAGIC);
    expect(readEconomySegment(packet, economyAt)).toEqual(PROFILE);

    const truncated = packet.subarray(0, packet.byteLength - 1);
    expect(readEconomySegment(truncated, economyAt)).toBeUndefined();
    expect(readEconomySegment(packet, economyAt - 2)).toBeUndefined();
  });

  it('上报值全部钳制：余额、等级、道具数量都不会越界', () => {
    const profile = sanitizeEconomyProfile({
      coins: -10,
      stats: { atkSpeedLv: 99 },
      inventory: { ice_americano: 500, unknown_item: 9 },
      houseTier: 42,
    });
    expect(profile.coins).toBe(0);
    expect(profile.stats.atkSpeedLv).toBe(10);
    expect(profile.inventory).toEqual({ ice_americano: 99 });
    expect(profile.houseTier).toBe(5);
    expect(clampCoins(1e12)).toBe(999_999_999);
  });
});

describe('钱包同步包', () => {
  it('携带余额、四维、房屋等级、原因与完整背包', () => {
    const packet = encodeWalletSync({
      coins: 999,
      stats: PROFILE.stats,
      houseTier: 2,
      reason: WALLET_REASON.MatchReward,
      inventory: { ice_americano: 3 },
    });
    expect(packet[0]).toBe(OpCode.S2C_WALLET_SYNC);
    expect(decodeWalletSync(packet)).toEqual({
      coins: 999,
      stats: PROFILE.stats,
      houseTier: 2,
      reason: WALLET_REASON.MatchReward,
      inventory: { ice_americano: 3 },
    });
  });

  it('背包为空时仍能往返，且最多占 12 字节', () => {
    const packet = encodeWalletSync({
      coins: 0,
      stats: PROFILE.stats,
      houseTier: 0,
      reason: WALLET_REASON.Init,
      inventory: {},
    });
    expect(packet.byteLength).toBe(12);
    expect(decodeWalletSync(packet).inventory).toEqual({});
  });

  it('截断的背包条目会直接报错而不是读出半个 count', () => {
    const packet = encodeWalletSync({
      coins: 1,
      stats: PROFILE.stats,
      houseTier: 0,
      reason: WALLET_REASON.Init,
      inventory: { ice_americano: 2 },
    });
    expect(() => decodeWalletSync(packet.subarray(0, packet.byteLength - 1))).toThrow(/truncated/);
  });
});

describe('P2P 邀请编解码', () => {
  it('邀请包 10 字节定长', () => {
    const packet = encodeP2PInvite({
      targetId: 7,
      gameType: P2P_GAME_TYPE.Duel,
      wager: 120,
      extra: 0,
    });
    expect(packet.byteLength).toBe(10);
    expect(decodeP2PInvite(packet)).toEqual({
      targetId: 7,
      gameType: P2P_GAME_TYPE.Duel,
      wager: 120,
      extra: 0,
    });
  });

  it('接受/拒绝回包 6 字节定长', () => {
    expect(decodeP2PRespond(encodeP2PRespond({ inviteId: 42, accept: true }))).toEqual({
      inviteId: 42,
      accept: true,
    });
    expect(decodeP2PRespond(encodeP2PRespond({ inviteId: 42, accept: false }))).toEqual({
      inviteId: 42,
      accept: false,
    });
  });

  it('邀请浮窗带名字与 TTL，无符号策略不会把负数写进去', () => {
    const packet = encodeP2PInviteNotify({
      inviteId: 1,
      fromId: 2,
      fromName: '夜班实习生',
      gameType: P2P_GAME_TYPE.Duel,
      wager: 100,
      extra: 0,
      ttlMs: 15_000,
    });
    const decoded = decodeP2PInviteNotify(packet);
    expect(decoded.fromName).toBe('夜班实习生');
    expect(decoded.ttlMs).toBe(15_000);
    expect(decoded.wager).toBe(100);
  });

  it('邀请结果与对局快照往返', () => {
    expect(decodeP2PInviteResult(encodeP2PInviteResult({ inviteId: 9, accepted: false, reason: 1 }))).toEqual({
      inviteId: 9,
      accepted: false,
      reason: 1,
    });
    const match = encodeP2PMatch({
      matchId: 11,
      gameType: P2P_GAME_TYPE.Duel,
      phase: P2P_MATCH_PHASE.Finished,
      remainingMs: 0,
      selfId: 3,
      opponentId: 8,
      opponentName: '卷王',
      wager: 50,
      winnerId: 3,
      endReason: 0,
    });
    expect(decodeP2PMatch(match)).toMatchObject({
      matchId: 11,
      phase: P2P_MATCH_PHASE.Finished,
      selfId: 3,
      opponentId: 8,
      opponentName: '卷王',
      winnerId: 3,
    });
  });
});

describe('打赏、道具与商店编解码', () => {
  it('打赏上行与广播往返，超过上限的金额被钳制', () => {
    expect(decodeTipRequest(encodeTipRequest({ targetId: 4, amount: 50 }))).toEqual({
      targetId: 4,
      amount: 50,
    });
    expect(decodeTipBroadcast(encodeTipBroadcast({ fromId: 1, toId: 2, amount: 50, received: true }))).toEqual({
      fromId: 1,
      toId: 2,
      amount: 50,
      received: true,
    });
  });

  it('道具包只认 u8 id，效果广播区分自己是否为目标', () => {
    expect(decodeUseItem(encodeUseItem({ targetId: 6, itemId: 3 }))).toEqual({
      targetId: 6,
      itemId: 3,
    });
    expect(decodeItemEffect(encodeItemEffect({ sourceId: 6, targetId: 6, itemId: 3, isTarget: true }))).toEqual({
      sourceId: 6,
      targetId: 6,
      itemId: 3,
      isTarget: true,
    });
  });

  it('商店购买包 4 字节定长', () => {
    const packet = encodeShopBuy({ kind: 1, id: 1, count: 1 });
    expect(packet.byteLength).toBe(4);
    expect(decodeShopBuy(packet)).toEqual({ kind: 1, id: 1, count: 1 });
  });
});

describe('经济数值口径', () => {
  it('发泄冷却随攻速递减并锁在 500ms', () => {
    expect(ventCooldownMs(0)).toBe(1200);
    expect(ventCooldownMs(3)).toBe(990);
    expect(ventCooldownMs(10)).toBe(500);
    expect(ventCooldownMs(99)).toBe(500);
  });

  it('冰美式按乘子缩短冷却，永远不会低于 500ms', () => {
    // ADR-0085：道具从「定值 −150ms」改成「乘 0.7」，与 ventCdMul 同一套语义
    expect(effectiveVentCooldownMs(0, 0.7)).toBe(840);
    expect(effectiveVentCooldownMs(10, 0.7)).toBe(500);
    expect(effectiveVentCooldownMs(2, 1)).toBe(1060);
  });

  it('属性升级价格随等级递增，封顶后没有下一档', () => {
    expect(statUpgradePrice('atkSpeedLv', 0)).toBe(120);
    expect(statUpgradePrice('atkSpeedLv', 5)).toBe(520);
    expect(statUpgradePrice('atkSpeedLv', 10)).toBe(920);
  });

  it('道具目录 id 唯一且价格为正', () => {
    const ids = ITEM_SKUS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ITEM_SKUS) expect(item.price).toBeGreaterThan(0);
  });

  it('赌注上限是个常量，客户端与服务端只读这一份', () => {
    expect(P2P_MAX_WAGER).toBe(5000);
  });
});
