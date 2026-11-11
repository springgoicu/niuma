import { browserStorage, readJson, writeJson, type StorageLike } from './storage';

/** 聊天面板的展开状态：localStorage，关标签页 / 关浏览器后仍保持上次的选择 */
export const CHAT_OPEN_KEY = 'niuma:chat-open:v1';

interface ChatPrefs {
  open: boolean;
}

/** 只认 `{ open: boolean }`；旧版本或其他模块写进来的字段一律丢掉 */
function sanitizeChatPrefs(raw: unknown): ChatPrefs | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<ChatPrefs>;
  if (typeof parsed.open !== 'boolean') return null;
  return { open: parsed.open };
}

/**
 * 读上次的展开状态。默认收起：没有记录、坏数据、隐私模式都当用户没做过选择，
 * 不能因为一次读取失败就把聊天面板硬塞到屏幕上。
 */
export function loadChatOpen(storage: StorageLike | null = browserStorage('local')): boolean {
  return readJson(storage, CHAT_OPEN_KEY, sanitizeChatPrefs)?.open ?? false;
}

/** 写展开状态：配额满 / 隐私模式写失败由 `writeJson` 静默兜底，不影响进服 */
export function saveChatOpen(
  open: boolean,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, CHAT_OPEN_KEY, { open } satisfies ChatPrefs);
}
