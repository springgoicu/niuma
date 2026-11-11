'use client';

import { Container } from 'pixi.js';

/**
 * 按脚底 y 分层的深度排序层。
 *
 * 原实现是「一个 `sortableChildren` 的大容器 + 每帧给每个角色写 zIndex」：
 * 树、围栏、桌椅、道具和角色全挤在同一个容器里（1500–2500 个子节点），
 * 角色一走动 zIndex 就变，于是每一帧都要把整张地图重排一次，
 * 重排还会打乱批处理顺序，把同图集的精灵切成一堆小批次。
 *
 * 这里按纵向切成若干 band，每个 band 是一个普通容器：
 * - band 之间不排序，靠父子顺序保证「y 小的先画」；
 * - band 内部仍然 `sortableChildren`，但只有几十个子节点。
 *
 * **正确性**：band k 里所有物体的 y 严格小于 band k+1 里所有物体的 y，
 * 而遮挡语义是「脚底 y 大的压 y 小的」，所以 band 顺序恒等价于 y 顺序。
 * 树冠向上伸出两个 band 高度也不会错——它跟着树干一起留在原来的 band 里，
 * 只要它比某个角色更靠后，就会在更早的 band 里被画出来。
 * band 高度只影响性能，不影响观感。
 */

/** band 高度（世界纹素）。256 约等于两个树高，地图被切成 20 多个 band */
export const BAND_HEIGHT = 256;

/**
 * 深度写入面：地形与道具只需要「按 y 放进去」，不必知道分桶细节。
 * 单容器回退模式实现同一个接口，所以回退路径也被日常代码覆盖。
 */
export interface DepthSink {
  add(y: number, child: Container): void;
  remove(child: Container): void;
  /** 帧循环用：会移动的物体（角色、小动物）位置变化后重新归 band */
  update(child: Container, y: number): void;
}

/** 纯函数：给定世界 y 返回 band 下标，越界钳到两端；NaN 归第一个 band */
export function bandIndexAt(y: number, originY: number, bandHeight: number, bandCount: number): number {
  if (bandCount <= 1) return 0;
  const raw = Math.floor((y - originY) / bandHeight);
  if (Number.isNaN(raw) || raw <= 0) return 0;
  return raw >= bandCount ? bandCount - 1 : raw;
}

export class SortLayer implements DepthSink {
  readonly container = new Container();
  private readonly bands: Container[] = [];
  private readonly originY: number;
  private readonly bandHeight: number;
  private readonly single: boolean;

  constructor(options: { originY: number; extentY: number; bandHeight?: number; single?: boolean }) {
    this.originY = options.originY;
    this.bandHeight = Math.max(1, options.bandHeight ?? BAND_HEIGHT);
    this.single = options.single === true;
    const count = this.single ? 1 : Math.max(1, Math.ceil(options.extentY / this.bandHeight) + 1);
    for (let i = 0; i < count; i += 1) {
      const band = new Container();
      band.sortableChildren = true;
      this.container.addChild(band);
      this.bands.push(band);
    }
  }

  /** 构造期用：静态物体按自己的 y 一次性归 band，之后永不移动 */
  add(y: number, child: Container): void {
    child.zIndex = y;
    this.bands[this.indexAt(y)]!.addChild(child);
  }

  /**
   * 帧循环用：同 band 只写 zIndex（值不变时 Pixi 自己会早退），
   * 跨 band 才换父容器。角色 165px/s ÷ 256 纹素 ≈ 每秒换一次。
   */
  update(child: Container, y: number): void {
    const band = this.bands[this.indexAt(y)]!;
    if (child.parent !== band) {
      child.parent?.removeChild(child);
      band.addChild(child);
    }
    child.zIndex = y;
  }

  remove(child: Container): void {
    child.parent?.removeChild(child);
  }

  /** 供调试与灰观测：band 太多说明高度取小了 */
  get bandCount(): number {
    return this.bands.length;
  }

  private indexAt(y: number): number {
    return bandIndexAt(y, this.originY, this.bandHeight, this.bands.length);
  }
}
