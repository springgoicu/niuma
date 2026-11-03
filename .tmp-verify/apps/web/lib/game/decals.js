'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECAL_CHANCE = exports.DECAL_CELL = exports.WILDFLOWER_KINDS = exports.BLOOM_KIND_BASE = exports.GROUND_DECAL_KINDS = exports.DECAL_KINDS = void 0;
exports.bloomDecalKind = bloomDecalKind;
exports.hashCell = hashCell;
exports.scatterDecals = scatterDecals;
/** 贴花种类与顺序同时决定图集里的帧号，两端只认这一份常量 */
exports.DECAL_KINDS = ['clover', 'daisy', 'grassTip', 'pebble', 'bloomWhite', 'bloomGold', 'bloomRose'];
/** 基础草地层只撒前四种：花只长在花海里与零散点缀层 */
exports.GROUND_DECAL_KINDS = [0, 1, 2, 3];
/** 三种花海贴花在 DECAL_KINDS 里的起点，与 FlowerPatch.palette 顺序一一对应 */
exports.BLOOM_KIND_BASE = 4;
/** 花海贴花在单个花田里的种类：0 白雏菊 / 1 金盏 / 2 暖粉 */
function bloomDecalKind(palette) {
    return exports.BLOOM_KIND_BASE + palette;
}
/** 全岛零散野花的种类池 */
exports.WILDFLOWER_KINDS = [exports.BLOOM_KIND_BASE, exports.BLOOM_KIND_BASE + 1, exports.BLOOM_KIND_BASE + 2];
/**
 * 贴花撒点：纯放置逻辑，不依赖 Pixi。
 *
 * 三条纪律：
 * 1. 用位置哈希而不是顺序随机——同一格在任何时候算出来的值都一样，
 *    视口来回移动不会让同一片草地的三叶草换位置；
 * 2. 基础层命中概率 0.12（需求的 8%–15% 带内），花海与野花层各自覆写概率与种类池；
 * 3. 是否允许生成由调用方注入（岛内、非水面、非广场、非土路），
 *    这样地形规则变了不用改这个模块。
 */
/** 栅格边长：与 32px 采样格成整数倍，贴花不会压在 autotile 的草缘上 */
exports.DECAL_CELL = 64;
exports.DECAL_CHANCE = 0.12;
/**
 * 位置哈希（Wang hash 变体）：只读 (x, y, seed)，不持有状态。
 * 用 Math.imul 而不是浮点乘法，保证各引擎结果逐位一致。
 */
function hashCell(x, y, seed) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function scatterDecals(bounds, allow, seed = 0x6d2b79f5, chance = exports.DECAL_CHANCE, kinds = exports.GROUND_DECAL_KINDS) {
    const pool = kinds.length > 0 ? kinds : exports.GROUND_DECAL_KINDS;
    const placements = [];
    const from = Math.floor(bounds.x / exports.DECAL_CELL);
    const to = Math.ceil((bounds.x + bounds.w) / exports.DECAL_CELL);
    const top = Math.floor(bounds.y / exports.DECAL_CELL);
    const bottom = Math.ceil((bounds.y + bounds.h) / exports.DECAL_CELL);
    for (let cy = top; cy < bottom; cy += 1) {
        for (let cx = from; cx < to; cx += 1) {
            if (hashCell(cx, cy, seed) >= chance)
                continue;
            // 格内抖动：落在格心附近，贴花不会排成方阵
            const x = Math.round(cx * exports.DECAL_CELL + (0.2 + hashCell(cx, cy, seed + 0x11) * 0.6) * exports.DECAL_CELL);
            const y = Math.round(cy * exports.DECAL_CELL + (0.25 + hashCell(cx, cy, seed + 0x23) * 0.65) * exports.DECAL_CELL);
            if (x < bounds.x || x > bounds.x + bounds.w || y < bounds.y || y > bounds.y + bounds.h)
                continue;
            if (!allow(x, y))
                continue;
            placements.push({
                kind: pool[Math.floor(hashCell(cx, cy, seed + 0x37) * pool.length) % pool.length],
                x,
                y,
                flip: hashCell(cx, cy, seed + 0x4b) > 0.5,
            });
        }
    }
    return placements;
}
