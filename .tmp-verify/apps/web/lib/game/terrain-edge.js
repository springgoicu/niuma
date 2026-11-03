'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDGE_STYLE = exports.EDGE_BIT = exports.EDGE_TILE = exports.EDGE_DRAW_ORDER = exports.PAINT_ORDER = exports.MATERIAL = void 0;
exports.materialAt = materialAt;
exports.buildMaterialGrid = buildMaterialGrid;
exports.gridAt = gridAt;
exports.gridSample = gridSample;
exports.edgeMaskAt = edgeMaskAt;
exports.canonical47 = canonical47;
exports.edgeGlyphs = edgeGlyphs;
const shared_types_1 = require("@niuma/shared-types");
const autotile_1 = require("./autotile");
const decals_1 = require("./decals");
const terrain_palette_1 = require("./terrain-palette");
exports.MATERIAL = {
    sea: 0,
    shallow: 1,
    sand: 2,
    grass: 3,
    dirt: 4,
    plaza: 5,
    water: 6,
    bridge: 7,
};
/**
 * 绘制顺序 = 优先级从低到高。后画的盖先画的，与 `TerrainView.build()` 的既有层序一致。
 * 边缘层的绘制顺序与它无关：草缘永远最后压上（见 EDGE_DRAW_ORDER）。
 */
exports.PAINT_ORDER = [
    exports.MATERIAL.sea,
    exports.MATERIAL.shallow,
    exports.MATERIAL.grass,
    exports.MATERIAL.sand,
    exports.MATERIAL.plaza,
    exports.MATERIAL.dirt,
    exports.MATERIAL.water,
    exports.MATERIAL.bridge,
];
/** 边缘层的绘制顺序：按「被覆盖」的先后，草地相关的边缘最后画 */
exports.EDGE_DRAW_ORDER = [
    exports.MATERIAL.sand,
    exports.MATERIAL.plaza,
    exports.MATERIAL.dirt,
    exports.MATERIAL.water,
    exports.MATERIAL.bridge,
];
/** 双网格采样格：与 autotile.TILE 同值，保证边缘判定与轮廓几何共用一个栅格 */
exports.EDGE_TILE = 32;
const BRIDGES = shared_types_1.WORLD_LAYOUT.bridges;
const PATHS = shared_types_1.WORLD_LAYOUT.paths;
const PLAZA = shared_types_1.WORLD_LAYOUT.plaza;
const LAKES = shared_types_1.WORLD_LAYOUT.lakes;
const RIVERS = shared_types_1.WORLD_LAYOUT.rivers;
const ISLAND_POINTS = shared_types_1.ISLAND.points;
const SAND_SQ = shared_types_1.ISLAND_SAND * shared_types_1.ISLAND_SAND;
const SHALLOW_SQ = shared_types_1.ISLAND_SHALLOW * shared_types_1.ISLAND_SHALLOW;
/**
 * 某点的材质。顺序即优先级，先命中者胜：
 * 桥 > 水（湖/河）> 土路 > 广场 > 岸沙带 > 草地 > 浅滩 > 海。
 *
 * 为什么水在土路之前：河道穿过土路时水面必须盖住路面（当前布局里只有桥头相交，
 * 但布局一改就会出现真的穿路），而桥又在最前面放行。
 */
function materialAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return exports.MATERIAL.sea;
    for (const bridge of BRIDGES) {
        if ((0, shared_types_1.rectContains)(bridge, x, y))
            return exports.MATERIAL.bridge;
    }
    for (const lake of LAKES) {
        // 先过包围盒：湖面判定是 20 点多边形，逐点跑一遍太贵
        if ((0, shared_types_1.rectContains)(lake.rect, x, y) && (0, shared_types_1.pointInPolygon)(x, y, lake.points))
            return exports.MATERIAL.water;
    }
    for (const river of RIVERS) {
        if ((0, shared_types_1.rectContains)(river.rect, x, y) && (0, shared_types_1.pointInPolygon)(x, y, river.polygon))
            return exports.MATERIAL.water;
    }
    for (const path of PATHS) {
        if ((0, shared_types_1.rectContains)(path, x, y))
            return exports.MATERIAL.dirt;
    }
    if ((0, shared_types_1.rectContains)(PLAZA, x, y))
        return exports.MATERIAL.plaza;
    // 岸沙带以海岸线为中线的 26px 带：一半在水里一半在陆地
    const distance = (0, shared_types_1.distanceSqToPolygon)(x, y, ISLAND_POINTS);
    if (distance <= SAND_SQ)
        return exports.MATERIAL.sand;
    if ((0, shared_types_1.pointInPolygon)(x, y, ISLAND_POINTS))
        return exports.MATERIAL.grass;
    if (distance <= SHALLOW_SQ)
        return exports.MATERIAL.shallow;
    return exports.MATERIAL.sea;
}
function buildMaterialGrid(tile = exports.EDGE_TILE) {
    const cols = Math.ceil(shared_types_1.WORLD_WIDTH / tile);
    const rows = Math.ceil(shared_types_1.WORLD_HEIGHT / tile);
    const cells = new Uint8Array(cols * rows);
    const half = tile / 2;
    for (let gy = 0; gy < rows; gy += 1) {
        const y = gy * tile + half;
        const row = gy * cols;
        for (let gx = 0; gx < cols; gx += 1) {
            cells[row + gx] = materialAt(gx * tile + half, y);
        }
    }
    return { tile, cols, rows, cells };
}
function gridAt(grid, gx, gy) {
    if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows)
        return exports.MATERIAL.sea;
    return grid.cells[gy * grid.cols + gx];
}
/** 世界坐标取格：与构造期采样同相位（格心） */
function gridSample(grid, x, y) {
    const gx = Math.floor(x / grid.tile);
    const gy = Math.floor(y / grid.tile);
    return gridAt(grid, gx, gy);
}
/* ------------------------------------------------------------------ *
 * 8 邻位掩码：N E S W + NE SE SW NW
 * ------------------------------------------------------------------ */
exports.EDGE_BIT = {
    n: 1,
    e: 2,
    s: 4,
    w: 8,
    ne: 16,
    se: 32,
    sw: 64,
    nw: 128,
};
/** 八个方向：按位从低到高，顺时针 */
const DIRS = [
    { bit: exports.EDGE_BIT.n, nx: 0, ny: -1 },
    { bit: exports.EDGE_BIT.e, nx: 1, ny: 0 },
    { bit: exports.EDGE_BIT.s, nx: 0, ny: 1 },
    { bit: exports.EDGE_BIT.w, nx: -1, ny: 0 },
    { bit: exports.EDGE_BIT.ne, nx: 1, ny: -1 },
    { bit: exports.EDGE_BIT.se, nx: 1, ny: 1 },
    { bit: exports.EDGE_BIT.sw, nx: -1, ny: 1 },
    { bit: exports.EDGE_BIT.nw, nx: -1, ny: -1 },
];
/**
 * 8 邻掩码：位为 1 表示该方向相邻格不是 `self`。
 * 这是需求里「边缘判定位运算」的入口：后续所有草尖/圆弧/内凹都由它派生。
 */
function edgeMaskAt(grid, x, y, self) {
    const gx = Math.floor(x / grid.tile);
    const gy = Math.floor(y / grid.tile);
    let mask = 0;
    for (const dir of DIRS) {
        if (gridAt(grid, gx + dir.nx, gy + dir.ny) !== self)
            mask |= dir.bit;
    }
    return mask;
}
/**
 * 孤立斜角归一化：斜角邻居为异类、但两侧正交邻居都是同类时，
 * 这个斜角不构成真实边界（只是对角线擦到另一个区域），清掉。
 * 47 态拼贴里这类状态本来就不存在，不归一化会让状态数虚增。
 */
function normalizeMask(mask) {
    let out = mask;
    const pairs = [
        [exports.EDGE_BIT.ne, exports.EDGE_BIT.n, exports.EDGE_BIT.e],
        [exports.EDGE_BIT.se, exports.EDGE_BIT.s, exports.EDGE_BIT.e],
        [exports.EDGE_BIT.sw, exports.EDGE_BIT.s, exports.EDGE_BIT.w],
        [exports.EDGE_BIT.nw, exports.EDGE_BIT.n, exports.EDGE_BIT.w],
    ];
    for (const [corner, a, b] of pairs) {
        if ((out & corner) !== 0 && (out & a) === 0 && (out & b) === 0)
            out &= ~corner;
    }
    return out;
}
/** D4 群（4 旋转 × 2 镜像）的 8 个变换查找表，模块加载时一次算好 */
const TRANSFORMS = (() => {
    const tables = [];
    const transforms = [
        (x, y) => [x, y],
        (x, y) => [-y, x],
        (x, y) => [-x, -y],
        (x, y) => [y, -x],
        (x, y) => [-x, y],
        (x, y) => [x, -y],
        (x, y) => [y, x],
        (x, y) => [-y, -x],
    ];
    for (const transform of transforms) {
        const table = new Uint8Array(256);
        for (let mask = 0; mask < 256; mask += 1) {
            let mapped = 0;
            for (const dir of DIRS) {
                if ((mask & dir.bit) === 0)
                    continue;
                const [tx, ty] = transform(dir.nx, dir.ny);
                const hit = DIRS.find((candidate) => candidate.nx === tx && candidate.ny === ty);
                if (hit)
                    mapped |= hit.bit;
            }
            table[mask] = mapped;
        }
        tables.push(table);
    }
    return tables;
})();
/**
 * 47 态归一化：先清掉孤立斜角，再把 8 邻掩码按旋转/镜像折叠成同一等价类。
 * 256 种输入收敛到 47 类以内，等价类用最小掩码表示。
 *
 * 注意：这里只做状态归类，**不查 47 张图集**——拼贴块会把材质相位切断（ADR-0013），
 * 边缘图元仍由 `edgeGlyphs` 按解析轮廓逐个生成。
 */
function canonical47(mask) {
    const normalized = normalizeMask(mask & 0xff);
    let best = normalized;
    for (const table of TRANSFORMS) {
        const value = table[normalized];
        if (value < best)
            best = value;
    }
    return best;
}
exports.EDGE_STYLE = {
    [exports.MATERIAL.sea]: {
        rim: terrain_palette_1.TERRAIN_COLORS.waterEdge,
        rimWidth: 1,
        tooth: null,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.seaBase,
        toothLen: [1],
        step: 10,
        scallop: null,
        scallopEvery: 0,
        scallopRadius: 0,
    },
    [exports.MATERIAL.shallow]: {
        rim: terrain_palette_1.TERRAIN_COLORS.waterEdge,
        rimWidth: 1,
        tooth: terrain_palette_1.TERRAIN_COLORS.shoreShallow,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.waterMid,
        toothLen: [2, 3],
        step: 9,
        scallop: null,
        scallopEvery: 0,
        scallopRadius: 0,
    },
    [exports.MATERIAL.sand]: {
        rim: terrain_palette_1.TERRAIN_COLORS.sandEdge,
        rimWidth: 1,
        tooth: terrain_palette_1.TERRAIN_COLORS.sandLight,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.sand,
        toothLen: [2, 3],
        step: 8,
        scallop: null,
        scallopEvery: 0,
        scallopRadius: 0,
    },
    [exports.MATERIAL.grass]: {
        rim: terrain_palette_1.TERRAIN_COLORS.grassDeep,
        rimWidth: 2,
        tooth: terrain_palette_1.TERRAIN_COLORS.grassTuft,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.grassDeep,
        toothLen: [2, 3, 4],
        step: 6,
        scallop: terrain_palette_1.TERRAIN_COLORS.grassAlt,
        scallopEvery: 46,
        scallopRadius: 4,
    },
    [exports.MATERIAL.dirt]: {
        rim: terrain_palette_1.TERRAIN_COLORS.dirtEdge,
        rimWidth: 2,
        tooth: terrain_palette_1.TERRAIN_COLORS.grassTuft,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.grassDeep,
        toothLen: [2, 3, 4],
        step: 6,
        scallop: terrain_palette_1.TERRAIN_COLORS.grassAlt,
        scallopEvery: 46,
        scallopRadius: 4,
    },
    [exports.MATERIAL.plaza]: {
        rim: terrain_palette_1.TERRAIN_COLORS.plazaSeam,
        rimWidth: 1,
        tooth: terrain_palette_1.TERRAIN_COLORS.grassTuft,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.grassDeep,
        toothLen: [2, 3],
        step: 7,
        scallop: terrain_palette_1.TERRAIN_COLORS.grassAlt,
        scallopEvery: 52,
        scallopRadius: 3,
    },
    [exports.MATERIAL.water]: {
        rim: terrain_palette_1.TERRAIN_COLORS.waterEdge,
        rimWidth: 2,
        tooth: terrain_palette_1.TERRAIN_COLORS.waterFoam,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.waterCrest,
        toothLen: [1, 2],
        step: 8,
        scallop: null,
        scallopEvery: 0,
        scallopRadius: 0,
    },
    [exports.MATERIAL.bridge]: {
        rim: terrain_palette_1.TERRAIN_COLORS.bridgeSeam,
        rimWidth: 1,
        tooth: null,
        toothDeep: terrain_palette_1.TERRAIN_COLORS.fenceLight,
        toothLen: [1],
        step: 10,
        scallop: null,
        scallopEvery: 0,
        scallopRadius: 0,
    },
};
/** 草是被地：只要对面是草，草色齿一律由草来长，不管自己是土、石还是沙 */
const GRASS_FRINGE = exports.EDGE_STYLE[exports.MATERIAL.grass];
/**
 * 沿轮廓生成草尖与外凸圆弧。
 *
 * 方向规则只有一条：**草往对面的材质里长**。
 * - 对面是草（土路、广场、湖岸、岸沙带）：齿朝轮廓内侧长，草盖住泥/石/水；
 * - 自己是草：齿朝外长；
 * - 其余配对（沙↔浅滩、水↔沙）：齿朝外长，用自己材质的色。
 */
function edgeGlyphs(contour, options) {
    const { self, other } = options;
    const outset = options.outset ?? 0;
    const seed = options.seed ?? 0x51ed270b;
    const cap = options.cap ?? 4096;
    const grid = options.grid;
    if (contour.length < 3)
        return [];
    const outward = [...contour];
    if ((0, autotile_1.contourSignedArea)(contour) <= 0)
        outward.reverse();
    const fringe = other === exports.MATERIAL.grass ? GRASS_FRINGE : exports.EDGE_STYLE[self];
    const tooth = fringe.tooth ?? exports.EDGE_STYLE[self].tooth;
    if (tooth === null && fringe.scallop === null)
        return [];
    const style = fringe;
    const toothDeep = fringe.toothDeep;
    /** 草往对面长 = 沿外法线反向；其余材质往外长 */
    const grow = options.grow ?? (other === exports.MATERIAL.grass ? 'in' : 'out');
    const sign = grow === 'in' ? -1 : 1;
    const glyphs = [];
    let lastState = -1;
    let sinceScallop = 0;
    const visit = (x, y, nx, ny) => {
        if (glyphs.length >= cap)
            return;
        const px = Math.round(x + nx * outset);
        const py = Math.round(y + ny * outset);
        if (grid) {
            // 探针向两侧各探 3px：只要有一侧是 other，这条边就成立。
            // 用解析材质而不是 32px 网格：网格格心离边界最多 16px，会把贴边的齿全判成异类。
            const outside = materialAt(px + nx * 3, py + ny * 3);
            const inside = materialAt(px - nx * 3, py - ny * 3);
            if (outside !== other && inside !== other)
                return;
            const state = canonical47(edgeMaskAt(grid, px, py, self));
            if (state !== lastState) {
                lastState = state;
                // 状态变化 = 转角：外侧补一个圆弧，尖角才不扎
                if (style.scallop !== null) {
                    stampScallop(glyphs, px, py, nx * sign, ny * sign, style.scallopRadius, style.scallop, cap);
                    sinceScallop = 0;
                }
            }
        }
        const random = (0, decals_1.hashCell)(px, py, seed);
        const detail = (0, decals_1.hashCell)(px, py, seed ^ 0x9e37);
        const growX = nx * sign;
        const growY = ny * sign;
        sinceScallop += style.step;
        if (style.scallop !== null && style.scallopEvery > 0 && sinceScallop >= style.scallopEvery) {
            sinceScallop = 0;
            stampScallop(glyphs, px, py, growX, growY, style.scallopRadius, style.scallop, cap);
        }
        // 三七开：七成探出、三成缩回，全是外突会变成一圈花边
        const outwardTooth = random > 0.28;
        if (!outwardTooth)
            return;
        if (tooth === null)
            return;
        const lengths = style.toothLen;
        const length = lengths[Math.floor(detail * lengths.length) % lengths.length];
        const color = detail > 0.68 ? toothDeep : tooth;
        // 斜向法线（圆弧段）按主轴取横/竖齿，齿永远落在整数像素上
        if (Math.abs(growY) >= Math.abs(growX)) {
            const top = growY > 0 ? py : py - length + 1;
            glyphs.push({ x: px, y: top, w: 1, h: length, color });
            if (detail > 0.82) {
                // 偶尔来一撮两像素宽的草，边缘才不是整齐的梳子
                const side = Math.round(x + nx * outset) + (detail > 0.9 ? 1 : -1);
                glyphs.push({ x: side, y: growY > 0 ? py : py - length, w: 1, h: length, color });
            }
        }
        else {
            const left = growX > 0 ? px : px - length + 1;
            glyphs.push({ x: left, y: py, w: length, h: 1, color });
            if (detail > 0.82) {
                const side = Math.round(y + ny * outset) + (detail > 0.9 ? 1 : -1);
                glyphs.push({ x: growX > 0 ? px : px - length, y: side, w: length, h: 1, color });
            }
        }
    };
    walkContour(outward, style.step, visit);
    return glyphs;
}
/** 沿轮廓按弧长等距走一遍，带回外法线（顺时针轮廓的外法线是 (dy, -dx)） */
function walkContour(contour, step, visit) {
    let carry = 0;
    for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 0)
            continue;
        const nx = dy / len;
        const ny = -dx / len;
        let t = carry;
        while (t < len) {
            visit(a.x + (dx * t) / len, a.y + (dy * t) / len, nx, ny);
            t += step;
        }
        carry = t - len;
    }
}
/** 半圆凸起：贴边一行最宽，往里逐渐收窄，肉眼看就是草边鼓出来一块 */
function stampScallop(out, px, py, gx, gy, radius, color, cap) {
    if (radius <= 0)
        return;
    if (Math.abs(gy) >= Math.abs(gx)) {
        const dir = gy > 0 ? 1 : -1;
        for (let row = 0; row < radius; row += 1) {
            const half = Math.round(Math.sqrt(radius * radius - row * row));
            if (half <= 0)
                continue;
            out.push({ x: px - half, y: py + dir * row, w: half * 2, h: 1, color });
            if (out.length >= cap)
                return;
        }
        return;
    }
    const dir = gx > 0 ? 1 : -1;
    for (let col = 0; col < radius; col += 1) {
        const half = Math.round(Math.sqrt(radius * radius - col * col));
        if (half <= 0)
            continue;
        out.push({ x: px + dir * col, y: py - half, w: 1, h: half * 2, color });
        if (out.length >= cap)
            return;
    }
}
