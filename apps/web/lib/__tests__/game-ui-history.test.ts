import { beforeEach, describe, expect, it } from 'bun:test';
import { useGameUi } from '../game-ui';
import type { ChatEntry } from '../game/session';

function chat(id: number, at: number, extra: Partial<ChatEntry> = {}): ChatEntry {
  return { id, name: '阿牛', text: `第${id}条`, at, self: false, history: true, ...extra };
}

function system(id: number, at: number): ChatEntry {
  return { id, name: '', text: '有人进入了园区', at, self: false, kind: 'system' };
}

describe('园区频道历史合并', () => {
  beforeEach(() => useGameUi.getState().reset());

  it('首屏快照整表替换，且不制造未读', () => {
    useGameUi.getState().applyHistory([chat(10, 1_000), chat(11, 2_000)], {
      replace: true,
      hasMore: true,
    });

    const state = useGameUi.getState();
    expect(state.messages.map((message) => message.id)).toEqual([10, 11]);
    // 进园补发十条不该让人一进来就看到「10 条未读」
    expect(state.unread).toBe(0);
    expect(state.history).toEqual({ loading: false, hasMore: true, cursor: 10 });
  });

  it('上翻前插：去重后按时间排序，游标跟着前移', () => {
    useGameUi.getState().applyHistory([chat(10, 10_000), chat(11, 11_000)], {
      replace: true,
      hasMore: true,
    });
    // 10 已经在了：同一页重复到达（重连 / 抖动）不能出现两遍
    useGameUi.getState().applyHistory([chat(9, 9_000), chat(10, 10_000)], {
      replace: false,
      hasMore: false,
    });

    const state = useGameUi.getState();
    expect(state.messages.map((message) => message.id)).toEqual([9, 10, 11]);
    expect(state.history).toEqual({ loading: false, hasMore: false, cursor: 9 });
  });

  it('上翻返回空页时不动列表引用，也不前移游标', () => {
    useGameUi.getState().applyHistory([chat(10, 10_000), chat(11, 11_000)], {
      replace: true,
      hasMore: true,
    });
    useGameUi.getState().setHistoryLoading(true);
    const before = useGameUi.getState().messages;

    // 全是本地已有的条目：换新数组会让 ChatLog 多跑一次滚动判定，
    // 还会把「上翻到底」误当成新消息拉回底部
    useGameUi.getState().applyHistory([chat(10, 10_000), chat(11, 11_000)], {
      replace: false,
      hasMore: false,
    });

    const state = useGameUi.getState();
    expect(state.messages).toBe(before);
    expect(state.history).toEqual({ loading: false, hasMore: false, cursor: 10 });
  });

  it('游标永远指向最旧的一条聊天：负数系统消息 id 不参与', () => {
    useGameUi.getState().pushMessage(system(-1, 5_000));
    useGameUi.getState().applyHistory([chat(7, 7_000), chat(8, 8_000)], {
      replace: false,
      hasMore: true,
    });

    expect(useGameUi.getState().history.cursor).toBe(7);
  });

  it('列表裁剪到 200 条，历史不会无限增长', () => {
    const entries = Array.from({ length: 205 }, (_, i) => chat(i + 1, 1_000 + i));
    useGameUi.getState().applyHistory(entries, { replace: true, hasMore: false });

    const messages = useGameUi.getState().messages;
    expect(messages).toHaveLength(200);
    expect(messages[0]!.id).toBe(6);
    expect(messages[messages.length - 1]!.id).toBe(205);
  });

  it('面板收起时累计未读，展开即清零', () => {
    const ui = useGameUi.getState();
    ui.pushMessage(chat(1, 1_000));
    ui.pushMessage(chat(2, 2_000));
    ui.pushMessage(chat(3, 3_000));
    expect(useGameUi.getState().unread).toBe(3);

    useGameUi.getState().setChatOpen(true);
    expect(useGameUi.getState().unread).toBe(0);

    // 面板开着：看到的消息不再累计
    useGameUi.getState().pushMessage(chat(4, 4_000));
    expect(useGameUi.getState().unread).toBe(0);
  });

  it('状态编辑面板与聊天可以并存，不再互相收起', () => {
    const ui = useGameUi.getState();
    ui.setChatOpen(true);
    ui.setStatusOpen(true);

    expect(useGameUi.getState().chatOpen).toBe(true);
    expect(useGameUi.getState().statusOpen).toBe(true);

    // 收起状态面板也不该顺带关掉常驻的聊天
    useGameUi.getState().setStatusOpen(false);
    expect(useGameUi.getState().chatOpen).toBe(true);
  });

  it('没有本地记录时恢复保持收起，也不推进聚焦序号', () => {
    useGameUi.getState().setChatOpen(true);
    useGameUi.getState().reset();
    const seq = useGameUi.getState().chatFocusSeq;

    useGameUi.getState().restoreChatOpen();

    expect(useGameUi.getState().chatOpen).toBe(false);
    expect(useGameUi.getState().chatFocusSeq).toBe(seq);
  });
});
