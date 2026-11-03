'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRINGE_STEP = exports.CORNER_RADIUS = exports.TILE = void 0;
exports.roundedRectContour = roundedRectContour;
exports.contourSignedArea = contourSignedArea;
exports.contourPolygon = contourPolygon;
exports.polygonContour = polygonContour;
exports.traceContour = traceContour;
exports.organicContour = organicContour;
exports.offsetContour = offsetContour;
exports.resampleContour = resampleContour;
exports.fringeTeeth = fringeTeeth;
const seeded_1 = require("./seeded");
/** 采样格：32px，与「32×32 像素网格整数倍」的纪律一致 */
exports.TILE = 32;
/** 圆角半径 = 半格：dual-grid 的经典半径，转角不会被量化成 45° 切角 */
exports.CORNER_RADIUS = exports.TILE / 2;
/** 草缘细草的步长（沿轮廓弧长） */
exports.FRINGE_STEP = 6;
function pushUnique(points, x, y) {
    const last = points[points.length - 1];
    if (last && last.x === x && last.y === y)
        return;
    points.push({ x, y });
}
/**
 * 圆角矩形轮廓：四条直边 + 四个 1px 步进的圆弧。
 * 顺时针（屏幕坐标 y 向下），最后一段与第一段不重复，交给 closePath 收口。
 */
function roundedRectContour(rect, radius = exports.CORNER_RADIUS) {
    const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
    const left = rect.x;
    const top = rect.y;
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    const points = [];
    if (r <= 0) {
        pushUnique(points, left, top);
        pushUnique(points, right, top);
        pushUnique(points, right, bottom);
        pushUnique(points, left, bottom);
        return points;
    }
    // 每个圆弧按 1px 弧长取样：半径 16 时约 25 个点，肉眼就是像素画里的圆角
    const arc = (cx, cy, fromDeg, toDeg) => {
        const steps = Math.max(3, Math.ceil((Math.abs(toDeg - fromDeg) / 90) * (Math.PI / 2) * r));
        for (let i = 0; i <= steps; i += 1) {
            const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
            pushUnique(points, Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r));
        }
    };
    pushUnique(points, left + r, top);
    pushUnique(points, right - r, top);
    arc(right - r, top + r, -90, 0);
    pushUnique(points, right, bottom - r);
    arc(right - r, bottom - r, 0, 90);
    pushUnique(points, left + r, bottom);
    arc(left + r, bottom - r, 90, 180);
    pushUnique(points, left, top + r);
    arc(left + r, top + r, 180, 270);
    return points;
}
/** 有符号面积：正数表示屏幕坐标下的顺时针 */
function contourSignedArea(contour) {
    let sum = 0;
    for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
}
/** 把闭合轮廓拉平成交给 Graphics.poly 的数组 */
function contourPolygon(contour) {
    const flat = [];
    for (const point of contour)
        flat.push(point.x, point.y);
    return flat;
}
/**
 * 多边形轮廓：凸角切成 1px 步进的圆角，凹角保持原样。
 *
 * 用二次贝塞尔而不是真圆弧：半径只有 8~12px，肉眼分不出，
 * 但贝塞尔在整数像素上采样更稳，也不会因为三角函数末位差异在两端画出不同形状。
 * 凸角判定依赖方向：屏幕坐标下，顺时针轮廓的凸角 cross(u, v) < 0。
 *
 * 只切凸角：凹角做圆角会向多边形内部凹进，容易与相邻边自交。
 */
function polygonContour(points, radius = 8) {
    const cleaned = [];
    for (const [x, y] of points) {
        const px = Math.round(x);
        const py = Math.round(y);
        const last = cleaned[cleaned.length - 1];
        if (last && last.x === px && last.y === py)
            continue;
        cleaned.push({ x: px, y: py });
    }
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (cleaned.length > 1 && first && last && first.x === last.x && first.y === last.y)
        cleaned.pop();
    if (cleaned.length < 3)
        return cleaned;
    const clockwise = contourSignedArea(cleaned) > 0;
    const ring = clockwise ? cleaned : cleaned.slice().reverse();
    const out = [];
    const r = Math.max(0, radius);
    for (let i = 0; i < ring.length; i += 1) {
        const cur = ring[i];
        const prev = ring[(i - 1 + ring.length) % ring.length];
        const next = ring[(i + 1) % ring.length];
        const ux = prev.x - cur.x;
        const uy = prev.y - cur.y;
        const vx = next.x - cur.x;
        const vy = next.y - cur.y;
        const ul = Math.hypot(ux, uy);
        const vl = Math.hypot(vx, vy);
        if (ul <= 0 || vl <= 0) {
            pushUnique(out, cur.x, cur.y);
            continue;
        }
        const cross = (ux / ul) * (vy / vl) - (uy / ul) * (vx / vl);
        const cut = Math.min(r, ul / 2, vl / 2);
        // cross < 0 = 顺时针轮廓的凸角；浅角（切线变化 < 30°）不切，否则会磨掉河的缓弯
        if (cross >= 0 || cut < 1 || Math.abs(cross) < 0.5) {
            pushUnique(out, cur.x, cur.y);
            continue;
        }
        const ax = cur.x + (ux / ul) * cut;
        const ay = cur.y + (uy / ul) * cut;
        const bx = cur.x + (vx / vl) * cut;
        const by = cur.y + (vy / vl) * cut;
        const steps = Math.max(2, Math.round(cut));
        for (let s = 0; s <= steps; s += 1) {
            const t = s / steps;
            const inv = 1 - t;
            const x = inv * inv * ax + 2 * inv * t * cur.x + t * t * bx;
            const y = inv * inv * ay + 2 * inv * t * cur.y + t * t * by;
            pushUnique(out, Math.round(x), Math.round(y));
        }
    }
    return out;
}
/** 描边一条闭合轮廓：不重复首点，靠 closePath 收口 */
function traceContour(sink, contour) {
    if (contour.length < 3)
        return;
    sink.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i += 1)
        sink.lineTo(contour[i].x, contour[i].y);
    sink.closePath();
}
/**
 * 有机轮廓：先取圆角矩形，再把每个顶点沿法线方向按平滑噪声外推。
 * 抖动幅度必须小于圆角半径，否则凹角会自交——这是「不规则林地」能用
 * 纯几何近似而不必上 marching squares 的前提。
 */
function organicContour(rect, seed, amplitude = 8, radius = exports.CORNER_RADIUS) {
    const base = roundedRectContour(rect, radius);
    const amp = Math.max(0, Math.min(amplitude, radius - 1));
    if (amp <= 0 || base.length < 4)
        return base;
    const random = (0, seeded_1.seeded)(seed);
    const raw = base.map(() => (random() * 2 - 1) * amp);
    // 5 点箱形滤波：把逐点跳变磨成缓慢起伏，边缘才像地被植物而不是锯齿
    const smooth = raw.map((_, index) => {
        let sum = 0;
        for (let k = -2; k <= 2; k += 1)
            sum += raw[(index + k + raw.length) % raw.length];
        return sum / 5;
    });
    const clockwise = contourSignedArea(base) > 0;
    return base.map((point, index) => {
        const prev = base[(index - 1 + base.length) % base.length];
        const next = base[(index + 1) % base.length];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        // 顺时针轮廓的外法线是 (dy, -dx)
        const nx = (clockwise ? dy : -dy) / len;
        const ny = (clockwise ? -dx : dx) / len;
        const shift = smooth[index];
        return { x: Math.round(point.x + nx * shift), y: Math.round(point.y + ny * shift) };
    });
}
/**
 * 沿法线整体外扩/内缩一条闭合轮廓。
 *
 * 每个顶点取相邻两点的平均切线求法线，不做真正的 miter 求交：
 * 偏移量只有 8~26px，边长远大于它，切角误差 ≤ 2px；
 * 而 miter 在海岸线的凹角处会自交出一根长刺（和 bevel 注释里同一类事故）。
 */
function offsetContour(contour, distance) {
    if (distance === 0 || contour.length < 3)
        return contour.slice();
    const clockwise = contourSignedArea(contour) > 0;
    const ring = clockwise ? contour : contour.slice().reverse();
    const out = [];
    for (let i = 0; i < ring.length; i += 1) {
        const prev = ring[(i - 1 + ring.length) % ring.length];
        const cur = ring[i];
        const next = ring[(i + 1) % ring.length];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy);
        if (len <= 0) {
            pushUnique(out, cur.x, cur.y);
            continue;
        }
        // 顺时针轮廓的外法线是 (dy, -dx)
        out.push({ x: Math.round(cur.x + (dy / len) * distance), y: Math.round(cur.y + (-dx / len) * distance) });
    }
    return out;
}
/** 沿轮廓按弧长等距重采样，用于草缘这种「按密度撒点」的场合 */
function resampleContour(contour, step) {
    const out = [];
    if (contour.length < 3 || step <= 0)
        return out;
    let carry = 0;
    for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 0)
            continue;
        let t = carry;
        while (t < len - 0.001) {
            out.push({ x: Math.round(a.x + (dx * t) / len), y: Math.round(a.y + (dy * t) / len) });
            t += step;
        }
        carry = t - len;
    }
    return out;
}
/**
 * 草缘：沿轮廓每 FRINGE_STEP 撒一个 1×1 像素的齿。
 * 三七开往外交替——全是外突起会变成一圈花边，全是内凹口则像脏边。
 */
function fringeTeeth(contour, step = exports.FRINGE_STEP, seed = 0x9e3779b9, depth = 2) {
    const teeth = [];
    if (contour.length < 3)
        return teeth;
    const clockwise = contourSignedArea(contour) > 0;
    const random = (0, seeded_1.seeded)(seed);
    let carry = 0;
    for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 0)
            continue;
        const nx = (clockwise ? dy : -dy) / len;
        const ny = (clockwise ? -dx : dx) / len;
        let t = carry;
        while (t < len - 0.001) {
            const px = a.x + (dx * t) / len;
            const py = a.y + (dy * t) / len;
            const outward = random() > 0.35;
            const sign = outward ? depth : -depth;
            teeth.push({
                x: Math.round(px + nx * sign),
                y: Math.round(py + ny * sign),
                tone: outward ? 1 : 0,
            });
            t += step;
        }
        carry = t - len;
    }
    return teeth;
}
