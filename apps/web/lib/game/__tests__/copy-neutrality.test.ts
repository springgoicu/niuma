import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DICE_SIDE,
  DICE_SIDE_NAME,
  NAV_TARGETS,
  P2P_GAME_NAME,
  VENUES,
} from '@niuma/shared-types';
import { arrivalCopy } from '../arrival-copy';
import { HINT, hintButton, touchHint } from '../hint-copy';

/**
 * 玩家可见文案的去赌化守护（ADR-0111）。
 *
 * 只扫「文案源」：场所名、档位名、玩法名、提示三表、到达副标题与版本工报。
 * 代码注释里出现旧称不算违规——注释不会渲染到页面上。
 */
const BANNED = /赌场|赌桌|赌局|赌博|押注|下注|押一把|押中|押大|彩池|注额|抽水|封盘|豹子|全押|赔率|庄家/;

const DICE_HALL = '摸鱼骰子馆';
const RELEASE_NOTES = new URL('../../../data/release-notes.json', import.meta.url);

describe('玩家可见文案去赌化（ADR-0111）', () => {
  it('场所名不含赌字样，骰子馆在两处名单里都叫新名字', () => {
    for (const name of VENUES.map((spec) => spec.name)) expect(name).not.toMatch(BANNED);
    for (const target of NAV_TARGETS) expect(target.name).not.toMatch(BANNED);
    expect(VENUES.find((spec) => spec.id === 'diceHall')?.name).toBe(DICE_HALL);
    expect(NAV_TARGETS.find((target) => target.id === 'diceHall')?.name).toBe(DICE_HALL);
  });

  it('到达横幅副标题跟得上新场所名，不回落兜底句', () => {
    const copy = arrivalCopy(DICE_HALL);
    expect(copy.title).toBe(DICE_HALL);
    expect(copy.subtitle).not.toBe('打卡点已更新');
    expect(copy.subtitle).not.toMatch(BANNED);
  });

  it('骰子档位与 1v1 玩法名都是中性说法', () => {
    for (const name of Object.values(DICE_SIDE_NAME)) expect(name).not.toMatch(BANNED);
    expect(DICE_SIDE_NAME[DICE_SIDE.Leopard]).toBe('同点');
    for (const name of Object.values(P2P_GAME_NAME)) expect(name).not.toMatch(BANNED);
  });

  it('上下文提示、键帽按钮与触屏提示三处都干净', () => {
    for (const text of Object.values(HINT)) {
      expect(text).not.toMatch(BANNED);
      expect(touchHint(text)).not.toMatch(BANNED);
    }
    expect(hintButton(HINT.dice)?.label).toBe('试一把');
    expect(hintButton(HINT.arenaBet)?.label).toBe('投选');
  });

  it('版本工报的历史条目与标题也不留赌桌黑话', () => {
    const raw = JSON.parse(readFileSync(RELEASE_NOTES, 'utf8')) as {
      entries: { title: string; changes: { text: string }[] }[];
    };
    for (const entry of raw.entries) {
      expect(entry.title).not.toMatch(BANNED);
      for (const change of entry.changes) expect(change.text).not.toMatch(BANNED);
    }
  });
});
