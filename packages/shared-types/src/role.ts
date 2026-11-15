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

/** spawn 尾段：`[0xfd][role u8]`，只有 role > 0 时才写 */
export const ROLE_EXTENSION_MAGIC = 0xfd;
export const ROLE_EXTENSION_BYTES = 2;
