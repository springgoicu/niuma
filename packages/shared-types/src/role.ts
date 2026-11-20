/**
 * 实体角色（保安身份）：spawn 的可选尾段。
 *
 * 只服务「保安头顶警灯」这一件事：普通玩家与普通同事不写这一段，包体与旧版完全一致。
 * 旧客户端读到 0xfd 会把它当成非法状态长度并忽略尾段，表现为没有警灯，不会崩溃。
 */

/** 普通玩家 / 普通同事 */
export const ENTITY_ROLE_PLAYER = 0;
/** 保安：客户端据此在头顶画红蓝警灯 */
export const ENTITY_ROLE_GUARD = 1;
/** 护士：急救站固定站桩 NPC，红十字由急救站渲染层按站位叠加 */
export const ENTITY_ROLE_NURSE = 2;
/** 清洁阿姨：自动拖地清理香蕉皮/咖啡渍 */
export const ENTITY_ROLE_CLEANER = 3;
/** 深夜程序员：工位周边熬夜走动，对话/送咖啡得赏金 */
export const ENTITY_ROLE_PROGRAMMER = 4;
/** 外卖小哥：高频配送巡游，误撞有彩蛋 */
export const ENTITY_ROLE_DELIVERY = 5;
/** 摸鱼查岗经理：靠近摸鱼玩家抓包 */
export const ENTITY_ROLE_MANAGER = 6;
/** 流浪赛博宠物：可安抚喂食，追捕时会帮忙咬保安腿 */
export const ENTITY_ROLE_PET = 7;
/** 4★ 通缉特勤：HR 机械杜宾犬 */
export const ENTITY_ROLE_ROBO_DOG = 8;
/** 5★ 通缉终极围剿：老板黄金压路机 */
export const ENTITY_ROLE_BOSS_STEAMROLLER = 9;

export type EntityRole =
  | typeof ENTITY_ROLE_PLAYER
  | typeof ENTITY_ROLE_GUARD
  | typeof ENTITY_ROLE_NURSE
  | typeof ENTITY_ROLE_CLEANER
  | typeof ENTITY_ROLE_PROGRAMMER
  | typeof ENTITY_ROLE_DELIVERY
  | typeof ENTITY_ROLE_MANAGER
  | typeof ENTITY_ROLE_PET
  | typeof ENTITY_ROLE_ROBO_DOG
  | typeof ENTITY_ROLE_BOSS_STEAMROLLER;

/** spawn 尾段：`[0xfd][role u8]`，只有 role > 0 时才写 */
export const ROLE_EXTENSION_MAGIC = 0xfd;
export const ROLE_EXTENSION_BYTES = 2;
