/**
 * 审核用的规范化：把「看起来不一样、读起来一样」的写法压成同一条串，
 * 同时记录每个规范化字符覆盖的原文码点区间，保证命中后能精确回写打码。
 *
 * 分两趟：第一趟只做 NFKC 与去噪（可能一字展开成多字），
 * 第二趟才折叠连续重复——折叠必须知道整段 run 有多长，否则 `fuuuck` 只能折成 `fuuck`。
 */

/** 空白、标点、符号、控制与格式字符一律不参与匹配：夹字绕过靠的就是它们 */
const NOISE = /[\p{P}\p{S}\p{Z}\p{C}]/u;

/** 逐字替换的常见谐音写法；只覆盖拉丁与数字，汉字形近字留到 v2（见 ADR-0028） */
const CONFUSABLE: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
};

/** 中日韩字符：叠字是中文最常见的绕过手法，所以从第 2 个重复字符起折叠 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

const REPEAT_CJK = 2;
/**
 * 拉丁字母从第 3 个起折叠：`ass` 这类正常拼写不会被折成 `as` 而误杀，
 * `fuuuck` 仍能折回 `fuck`。
 */
const REPEAT_LATIN = 3;

export interface NormalizedText {
  /** 参与匹配的串 */
  value: string;
  /** `value[i]` 覆盖的原文码点下标区间 `[start, end)` */
  start: number[];
  end: number[];
}

/**
 * 规范化并保留原文下标。原文按码点切分，`start` / `end` 都是码点下标，
 * 打码时直接按区间覆盖，不会把 emoji 的代理对切成半个字符。
 */
export function normalizeWithMap(text: string): NormalizedText {
  const chars = Array.from(text);

  // 第一趟：NFKC 压半角 + 小写 + 去噪 + 数字替换。并行数组，不造对象。
  const folded: string[] = [];
  const foldedStart: number[] = [];
  const foldedEnd: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    // 一个原文码点可能展开成多个（全角字母、兼容字形），展开后共用同一段原文区间
    const expanded = chars[i]!.normalize('NFKC').toLowerCase();
    for (const ch of expanded) {
      if (NOISE.test(ch)) continue;
      folded.push(CONFUSABLE[ch] ?? ch);
      foldedStart.push(i);
      foldedEnd.push(i + 1);
    }
  }

  // 第二趟：折叠连续重复。折叠后的区间要盖住整段 run，
  // 否则「话话」只会打码第一个「话」，第二个原样露出来。
  const value: string[] = [];
  const start: number[] = [];
  const end: number[] = [];

  let i = 0;
  while (i < folded.length) {
    const ch = folded[i]!;
    let run = 1;
    while (i + run < folded.length && folded[i + run] === ch) run += 1;

    const threshold = CJK.test(ch) ? REPEAT_CJK : REPEAT_LATIN;
    if (run >= threshold) {
      value.push(ch);
      start.push(foldedStart[i]!);
      end.push(foldedEnd[i + run - 1]!);
    } else {
      for (let k = 0; k < run; k += 1) {
        value.push(folded[i + k]!);
        start.push(foldedStart[i + k]!);
        end.push(foldedEnd[i + k]!);
      }
    }
    i += run;
  }

  return { value: value.join(''), start, end };
}
