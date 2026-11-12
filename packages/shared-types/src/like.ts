/**
 * 工牌点赞（ADR-0057）：跨玩家的一次性社交动作。
 *
 * 点赞由服务端裁决与计数，只存在进程内存里：目标离园或进程重启即清零。
 * 本文件只放常量与包体类型；编解码在 `protocol.ts`，避免与 ByteWriter/ByteReader
 * 形成循环依赖。
 */

/** spawn 尾段：`[0xfb][likes u16]`，只有 likes > 0 时才写 */
export const LIKE_EXTENSION_MAGIC = 0xfb;
export const LIKE_EXTENSION_BYTES = 3;

/** 查询包：`[op][targetId u16]` */
export const LIKE_REQUEST_BYTES = 3;
/** 广播包：`[op][targetId u16][likes u16][flags u8]` */
export const LIKE_PACKET_BYTES = 6;

/** 计数上限：协议字段是 u16，到顶只停增，不溢回 0 */
export const MAX_LIKES = 0xffff;

/** flags bit0：接收者就是点赞者，用于点亮工牌上的「已点赞」 */
export const LIKE_FLAG_SELF = 1;

export interface LikePacket {
  /** 被点赞的实体 */
  targetId: number;
  /** 服务端当前计数 */
  likes: number;
  /** 见 `LIKE_FLAG_SELF` */
  flags: number;
}
