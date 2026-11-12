/**
 * 工牌底部的伪条码 / 伪二维码：纯函数、由工号派生。
 *
 * 不是可扫的码，只是一张「看起来像证件」的纹理；同一个工号每次都长一样，
 * 换名字才会换纹理。放在独立模块里，档案弹窗与分享卡可以共用同一套几何。
 */

function hashString(input: string): number {
  let hash = 5381;
  for (const char of input) {
    hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

/** 伪条码：宽度由工号派生，返回需要着墨的条块。 */
export function barcodeBars(value: string): Array<{ x: number; width: number }> {
  let hash = hashString(value) || 1;
  const bars: Array<{ x: number; width: number }> = [];
  let cursor = 0;
  let index = 0;
  while (cursor < 118) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const width = 1 + (hash & 1);
    if (index % 2 === 0) bars.push({ x: cursor, width });
    cursor += width + 1 + ((hash >>> 9) & 1);
    index += 1;
  }
  return bars;
}

/** 伪二维码：三个定位角 + 由工号派生的模块，纯装饰但稳定可复现。 */
export function qrCells(value: string): Array<[number, number]> {
  let hash = hashString(value) || 1;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      const inFinder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (inFinder) {
        const lx = x > 13 ? x - 14 : x;
        const ly = y > 13 ? y - 14 : y;
        const edge = lx === 0 || lx === 6 || ly === 0 || ly === 6;
        const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
        if (edge || core) cells.push([x, y]);
        continue;
      }
      hash = (hash * 1103515245 + 12345 + x * 17 + y * 13) >>> 0;
      if ((hash >>> 11) & 1) cells.push([x, y]);
    }
  }
  return cells;
}
