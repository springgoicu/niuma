/**
 * 站点层物种档案：首屏选角舞台与下方物种区块共用这一份。
 *
 * 名字、拉丁名、配色、数值原先各写在各处，同一个「牛」在两处会各自漂移；
 * 收成一处之后，改文案或配色只需要动这里。
 */
export type SiteSpecies = 'cow' | 'horse';

export interface SpeciesProfile {
  key: SiteSpecies;
  name: string;
  /** 档案卡与首屏名牌上方的学名行 */
  latin: string;
  /** 选角舞台的一句定位：比档案卡的长简介短，只够立住人物 */
  tagline: string;
  /** 数值条形色，取自游戏内该物种的默认毛色 */
  color: string;
  blurb: string;
  stats: ReadonlyArray<readonly [string, number]>;
}

export const SPECIES: ReadonlyArray<SpeciesProfile> = [
  {
    key: 'cow',
    name: '牛',
    latin: 'BOS TAURUS · 稳定输出型',
    tagline: '产能曲线平得像心电图',
    color: '#f3efe4',
    blurb: '把稳定当美德。你的产能曲线像心电图一样平，但从不掉线。加班时你会安静地反刍，然后继续。',
    stats: [
      ['产能', 92],
      ['摸鱼', 38],
      ['咖啡耐受', 88],
    ] as const,
  },
  {
    key: 'horse',
    name: '马',
    latin: 'EQUUS FERUS · 高速迭代型',
    tagline: '总在赶下一个会',
    color: '#a96c3c',
    blurb: '跑得快，也想得多。你总在赶下一个会，并且真心相信这次能准点下班。鬃毛是你最后的体面。',
    stats: [
      ['产能', 76],
      ['摸鱼', 64],
      ['咖啡耐受', 55],
    ] as const,
  },
];
