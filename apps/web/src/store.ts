import type {
  AdjustType,
  AgentMemorySnapshot,
  AnnotationGroup,
  ChatContext,
  ChatMessage,
  Instrument,
  Period,
  StoredAnnotation,
  TimeSpanId,
  WatchGroup,
  WatchItem,
} from "@wyckoff/shared";
import { create } from "zustand";
import * as api from "./lib/api.js";
import { translate } from "./i18n.js";

const LAST_SYMBOL_KEY = "wyckoff:last-symbol";
let annotationLoadSequence = 0;
let memoryLoadSequence = 0;

/** 图表上可用的手动绘图工具，值即 KLineChart 的内置覆盖物名。 */
export const DRAWING_TOOLS = [
  { id: "segment", label: "趋势线" },
  { id: "rayLine", label: "射线" },
  { id: "horizontalStraightLine", label: "水平线" },
  { id: "horizontalSegment", label: "水平线段" },
  { id: "priceChannelLine", label: "平行通道" },
  { id: "fibonacciLine", label: "斐波那契" },
  { id: "wyckoffZone", label: "矩形区间" },
  { id: "simpleAnnotation", label: "文字标注" },
] as const;

export type DrawingToolId = (typeof DRAWING_TOOLS)[number]["id"];

export const INDICATORS = [
  { id: "MA", label: "MA", pane: "candle" },
  { id: "EMA", label: "EMA", pane: "candle" },
  { id: "BOLL", label: "BOLL", pane: "candle" },
  { id: "VOL", label: "VOL", pane: "sub" },
  { id: "MACD", label: "MACD", pane: "sub" },
  { id: "RSI", label: "RSI", pane: "sub" },
  { id: "KDJ", label: "KDJ", pane: "sub" },
] as const;

export type IndicatorId = (typeof INDICATORS)[number]["id"];

export interface ToolTraceItem {
  id: string;
  name: string;
  summary: string;
  ok: boolean;
  running: boolean;
  args?: unknown;
  durationMs?: number;
}

export interface ChatEntry extends ChatMessage {
  /** 流式输出进行中，用于渲染光标与禁用输入。 */
  streaming?: boolean;
  liveTrace?: ToolTraceItem[];
}

interface WorkbenchState {
  // —— 标的与图表参数 ——
  symbol: string;
  chartRevision: number;
  symbolRevision: number;
  instrumentName: string | null;
  instrumentNameEn: string | null;
  period: Period;
  adjust: AdjustType;
  timeSpan: TimeSpanId;
  indicators: IndicatorId[];
  activeTool: DrawingToolId | null;
  selectionMode: boolean;
  freeTier: boolean;

  // —— 收藏 ——
  watchGroups: WatchGroup[];
  watchItems: WatchItem[];
  /** 新增收藏时落到哪个分组。 */
  activeWatchGroupId: number | null;
  settingsOpen: boolean;

  // —— 标注 ——
  annotationGroups: AnnotationGroup[];
  annotations: StoredAnnotation[];
  agentMemory: AgentMemorySnapshot | null;

  // —— 对话 ——
  sessionId: string;
  messages: ChatEntry[];
  llmReady: boolean;
  pendingContext: ChatContext | null;
  /** 用于向图表层下发一次性指令（聚焦某段时间），由 ChartPanel 消费后清空。 */
  focusRequest: { startTime: number; endTime: number; nonce: number } | null;
  /** 画布当前可视时间范围，发给 Agent 作为视野上下文。 */
  viewport: { startTime: number; endTime: number } | null;

  // —— 全局 UI ——
  searchOpen: boolean;
  toast: { message: string; tone: "info" | "error" } | null;

  setSymbol: (symbol: string, name?: string | null, nameEn?: string | null) => Promise<void>;
  setPeriod: (period: Period) => void;
  setAdjust: (adjust: AdjustType) => void;
  setTimeSpan: (span: TimeSpanId) => void;
  toggleIndicator: (id: IndicatorId) => void;
  setActiveTool: (tool: DrawingToolId | null) => void;
  toggleSelectionMode: () => void;
  setSearchOpen: (open: boolean) => void;
  notify: (message: string, tone?: "info" | "error") => void;

  bootstrap: (authenticated?: boolean) => Promise<void>;
  clearPersonalData: () => void;
  refreshWatchlist: () => Promise<void>;
  setActiveWatchGroup: (id: number) => void;
  toggleWatch: (instrument: Pick<Instrument, "symbol">, groupId?: number) => Promise<void>;
  addToWatch: (symbol: string, groupId?: number) => Promise<void>;
  removeFromWatch: (symbol: string, groupId?: number) => Promise<void>;
  moveWatchItem: (symbol: string, fromGroupId: number, toGroupId: number) => Promise<void>;
  reorderWatchItems: (groupId: number, symbols: string[]) => Promise<void>;
  addWatchGroup: (name: string) => Promise<void>;
  renameWatchGroup: (id: number, name: string) => Promise<void>;
  removeWatchGroup: (id: number) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  refreshRuntimeStatus: (authenticated?: boolean) => Promise<void>;

  loadAnnotations: () => Promise<void>;
  loadAgentMemory: () => Promise<void>;
  applyAnnotationBatch: (groupId: string, title: string, annotations: StoredAnnotation[]) => void;
  removeAnnotationGroup: (groupId: string) => Promise<void>;
  toggleAnnotationGroup: (groupId: string) => Promise<void>;
  clearAllAnnotations: () => Promise<void>;
  registerUserAnnotation: (annotation: Parameters<typeof api.saveAnnotations>[0]["annotations"][number]) => Promise<void>;

  setPendingContext: (context: ChatContext | null) => void;
  setViewport: (viewport: { startTime: number; endTime: number } | null) => void;
  requestFocus: (startTime: number, endTime: number) => void;
  consumeFocus: () => void;
  appendMessage: (entry: ChatEntry) => void;
  updateLastAssistant: (updater: (entry: ChatEntry) => ChatEntry) => void;
  resetSession: () => void;
  restoreSessionForSymbol: (symbol: string) => Promise<void>;
}

function stopStreaming(messages: ChatEntry[]): ChatEntry[] {
  return messages.map(message => message.streaming ? {
    ...message, streaming: false,
    liveTrace: message.liveTrace?.map(trace => trace.running
      ? { ...trace, running: false, ok: false, summary: translate("chat.stopped") } : trace),
  } : message);
}

function newSessionId(): string {
  return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function firstUserGroup(groups: WatchGroup[]): WatchGroup | undefined {
  return groups.find((group) => !group.managed);
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  symbol: localStorage.getItem(LAST_SYMBOL_KEY) ?? "AAPL.US",
  chartRevision: 0,
  symbolRevision: 0,
  instrumentName: null,
  instrumentNameEn: null,
  period: "1d",
  adjust: "forward",
  timeSpan: "1Y",
  indicators: ["MA", "VOL"],
  activeTool: null,
  selectionMode: false,
  freeTier: true,

  watchGroups: [],
  watchItems: [],
  activeWatchGroupId: null,
  settingsOpen: false,
  annotationGroups: [],
  annotations: [],
  agentMemory: null,

  sessionId: newSessionId(),
  messages: [],
  llmReady: false,
  pendingContext: null,
  focusRequest: null,
  viewport: null,

  searchOpen: false,
  toast: null,

  async setSymbol(symbol, name, nameEn) {
    if (get().symbol === symbol) return;
    localStorage.setItem(LAST_SYMBOL_KEY, symbol);
    // 换标的等于换一个分析对象，会话与标注都要跟着切换。
    const chartRevision = get().chartRevision + 1;
    const symbolRevision = get().symbolRevision + 1;
    set({
      symbol,
      chartRevision,
      symbolRevision,
      activeTool: null,
      selectionMode: false,
      focusRequest: null,
      instrumentName: name ?? null,
      instrumentNameEn: nameEn ?? null,
      annotations: [],
      annotationGroups: [],
      messages: [],
      pendingContext: null,
      sessionId: newSessionId(),
      viewport: null,
    });

    await Promise.all([get().loadAnnotations(), get().loadAgentMemory(), get().restoreSessionForSymbol(symbol)]);
    if (!name) {
      try {
        const { instrument } = await api.fetchInstrument(symbol);
        if (get().symbolRevision === symbolRevision) {
          set({ instrumentName: instrument.name, instrumentNameEn: instrument.nameEn ?? null });
        }
      } catch {
        /* 名称拿不到不影响看图 */
      }
    }
  },

  setPeriod(period) {
    if (get().period === period) return;
    set({ period, messages: stopStreaming(get().messages), chartRevision: get().chartRevision + 1, annotations: [], annotationGroups: [],
      activeTool: null, selectionMode: false, focusRequest: null, pendingContext: null, viewport: null });
    void get().loadAnnotations();
    void get().loadAgentMemory();
  },

  setAdjust(adjust) {
    if (get().adjust === adjust) return;
    set({ adjust, messages: stopStreaming(get().messages), chartRevision: get().chartRevision + 1, pendingContext: null, focusRequest: null, viewport: null, activeTool: null, selectionMode: false });
    void get().loadAnnotations();
  },
  setTimeSpan: (timeSpan) => set({ timeSpan }),

  toggleIndicator: (id) =>
    set((state) => ({
      indicators: state.indicators.includes(id)
        ? state.indicators.filter((x) => x !== id)
        : [...state.indicators, id],
    })),

  setActiveTool: (tool) => set({ activeTool: tool, selectionMode: false }),
  toggleSelectionMode: () => set((state) => ({ selectionMode: !state.selectionMode, activeTool: null })),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  notify(message, tone = "info") {
    set({ toast: { message, tone } });
    setTimeout(() => {
      if (get().toast?.message === message) set({ toast: null });
    }, 4000);
  },

  async refreshRuntimeStatus(authenticated = false) {
    const [capabilities, chatStatus] = await Promise.allSettled([api.fetchCapabilities(), api.fetchChatStatus()]);
    if (capabilities.status === "fulfilled") set({ freeTier: capabilities.value.freeTier });
    if (chatStatus.status === "fulfilled") set({ llmReady: chatStatus.value.configured });
    if (authenticated) {
      try {
        const settings = await api.fetchLlmSettings();
        set({ llmReady: settings.configured });
      } catch {
        // Keep the operator status when per-user settings cannot be loaded.
      }
    }
  },

  async bootstrap(authenticated = false) {
    const tasks: Promise<unknown>[] = [get().refreshRuntimeStatus(authenticated)];
    if (authenticated) {
      tasks.push(get().refreshWatchlist(), get().loadAnnotations(), get().loadAgentMemory(), get().restoreSessionForSymbol(get().symbol));
    }
    await Promise.allSettled(tasks);

    try {
      const { symbol, symbolRevision } = get();
      const { instrument } = await api.fetchInstrument(symbol);
      if (get().symbolRevision === symbolRevision) set({ instrumentName: instrument.name });
    } catch {
      /* 名称拿不到不影响看图 */
    }
  },

  clearPersonalData() {
    set({
      watchGroups: [],
      watchItems: [],
      activeWatchGroupId: null,
      annotationGroups: [],
      annotations: [],
      agentMemory: null,
      messages: [],
      sessionId: newSessionId(),
      pendingContext: null,
      viewport: null,
    });
  },

  async refreshWatchlist() {
    const { groups, items } = await api.fetchWatchlist();
    const active = get().activeWatchGroupId;
    set({
      watchGroups: groups.filter(group => !group.managed),
      watchItems: items.filter(item => groups.some(group => group.id === item.groupId && !group.managed)),
      activeWatchGroupId:
        active && groups.some((g) => g.id === active && !g.managed) ? active : (firstUserGroup(groups)?.id ?? null),
    });
  },

  setActiveWatchGroup(id) {
    if (get().watchGroups.some((group) => group.id === id && !group.managed)) {
      set({ activeWatchGroupId: id });
    }
  },

  async toggleWatch({ symbol }, groupId) {
    const state = get();
    const userGroupIds = new Set(state.watchGroups.filter((group) => !group.managed).map((group) => group.id));
    const inAny = state.watchItems.some((item) => item.symbol === symbol && userGroupIds.has(item.groupId));
    const targetGroup = groupId ?? state.activeWatchGroupId ?? firstUserGroup(state.watchGroups)?.id;

    if (groupId !== undefined) {
      const inGroup = state.watchItems.some((item) => item.symbol === symbol && item.groupId === groupId);
      const payload = inGroup
        ? await api.removeFromWatchlist(symbol, groupId)
        : await api.addToWatchlist(symbol, groupId);
      set({ watchGroups: payload.groups, watchItems: payload.items });
      get().notify(inGroup ? translate("watch.removedGroup", { symbol }) : translate("watch.addedGroup", { symbol }));
      return;
    }

    if (inAny) {
      const payload = await api.removeFromWatchlist(symbol);
      set({ watchGroups: payload.groups, watchItems: payload.items });
      get().notify(translate("watch.removed", { symbol }));
      return;
    }

    if (targetGroup === undefined || targetGroup === null) {
      get().notify(translate("watch.noGroup"), "error");
      return;
    }
    const payload = await api.addToWatchlist(symbol, targetGroup);
    set({ watchGroups: payload.groups, watchItems: payload.items });
    get().notify(translate("watch.added", { symbol }));
  },

  async addToWatch(symbol, groupId) {
    const target = groupId ?? get().activeWatchGroupId ?? firstUserGroup(get().watchGroups)?.id;
    if (target === undefined || target === null) {
      get().notify(translate("watch.noGroup"), "error");
      return;
    }
    const payload = await api.addToWatchlist(symbol, target);
    set({ watchGroups: payload.groups, watchItems: payload.items });
    get().notify(translate("watch.added", { symbol }));
  },

  async removeFromWatch(symbol, groupId) {
    const payload = await api.removeFromWatchlist(symbol, groupId);
    set({ watchGroups: payload.groups, watchItems: payload.items });
  },

  async moveWatchItem(symbol, fromGroupId, toGroupId) {
    if (fromGroupId === toGroupId) return;
    if (get().watchGroups.some((group) => (group.id === fromGroupId || group.id === toGroupId) && group.managed)) {
      get().notify(translate("watch.locked"), "error");
      return;
    }
    await api.addToWatchlist(symbol, toGroupId);
    const payload = await api.removeFromWatchlist(symbol, fromGroupId);
    set({ watchGroups: payload.groups, watchItems: payload.items });
    get().notify(translate("watch.moved", { symbol }));
  },

  async reorderWatchItems(groupId, symbols) {
    const payload = await api.reorderWatchlist(groupId, symbols);
    set({ watchGroups: payload.groups, watchItems: payload.items });
  },

  async addWatchGroup(name) {
    const payload = await api.createWatchGroup(name);
    const created = payload.groups.find((g) => g.name === name) ?? payload.groups.at(-1);
    set({
      watchGroups: payload.groups,
      watchItems: payload.items,
      activeWatchGroupId: created?.id ?? get().activeWatchGroupId,
    });
  },

  async renameWatchGroup(id, name) {
    const payload = await api.renameWatchGroup(id, name);
    set({ watchGroups: payload.groups, watchItems: payload.items });
  },

  async removeWatchGroup(id) {
    const payload = await api.deleteWatchGroup(id);
    const active = get().activeWatchGroupId;
    set({
      watchGroups: payload.groups,
      watchItems: payload.items,
      activeWatchGroupId: active === id ? (firstUserGroup(payload.groups)?.id ?? null) : active,
    });
  },

  async loadAgentMemory() {
    const { symbol, period, chartRevision } = get();
    const sequence = ++memoryLoadSequence;
    const current = () => get().chartRevision === chartRevision && sequence === memoryLoadSequence;
    try {
      const memory = await api.fetchAgentMemory({ symbol, period });
      if (current()) set({ agentMemory: memory });
    } catch {
      if (current()) set({ agentMemory: null });
    }
  },

  async loadAnnotations() {
    const { symbol, period, chartRevision } = get();
    const sequence = ++annotationLoadSequence;
    const current = () => get().chartRevision === chartRevision && sequence === annotationLoadSequence;
    try {
      const { groups, annotations } = await api.fetchAnnotations(symbol, period);
      if (current()) set({ annotationGroups: groups, annotations });
    } catch {
      if (current()) set({ annotationGroups: [], annotations: [] });
    }
  },

  applyAnnotationBatch(groupId, title, annotations) {
    set((state) => ({
      annotationGroups: state.annotationGroups.some((g) => g.groupId === groupId)
        ? state.annotationGroups
        : [
            ...state.annotationGroups,
            { groupId, symbol: state.symbol, period: state.period, title, createdAt: Date.now(), visible: true },
          ],
      annotations: [...state.annotations.filter((a) => a.groupId !== groupId), ...annotations],
    }));
  },

  async removeAnnotationGroup(groupId) {
    await api.deleteAnnotationGroup(groupId);
    set((state) => ({
      annotationGroups: state.annotationGroups.filter((g) => g.groupId !== groupId),
      annotations: state.annotations.filter((a) => a.groupId !== groupId),
    }));
  },

  async toggleAnnotationGroup(groupId) {
    const group = get().annotationGroups.find((g) => g.groupId === groupId);
    if (!group) return;
    const visible = !group.visible;
    await api.setAnnotationGroupVisible(groupId, visible);
    set((state) => ({
      annotationGroups: state.annotationGroups.map((g) => (g.groupId === groupId ? { ...g, visible } : g)),
    }));
  },

  async clearAllAnnotations() {
    const { symbol, period, chartRevision } = get();
    await api.clearAnnotations(symbol, period);
    if (get().chartRevision === chartRevision) {
      ++annotationLoadSequence;
      set({ annotations: [], annotationGroups: [] });
    }
  },

  async registerUserAnnotation(annotation) {
    const { symbol, period, chartRevision } = get();
    const { groupId, annotations } = await api.saveAnnotations({
      symbol,
      period,
      title: translate("chart.userAnnotation"),
      annotations: [annotation],
    });
    if (get().chartRevision === chartRevision) get().applyAnnotationBatch(groupId, translate("chart.userAnnotation"), annotations);
  },

  setPendingContext: (pendingContext) => set({ pendingContext }),
  setViewport: (viewport) => set({ viewport }),
  requestFocus: (startTime, endTime) => set({ focusRequest: { startTime, endTime, nonce: Date.now() } }),
  consumeFocus: () => set({ focusRequest: null }),

  appendMessage: (entry) => set((state) => ({ messages: [...state.messages, entry] })),

  updateLastAssistant(updater) {
    set((state) => {
      const index = state.messages.findLastIndex((m) => m.role === "assistant");
      if (index < 0) return state;
      const next = [...state.messages];
      next[index] = updater(next[index]);
      return { messages: next };
    });
  },

  resetSession: () => set({ sessionId: newSessionId(), messages: [], pendingContext: null }),

  async restoreSessionForSymbol(symbol) {
    const { chartRevision, sessionId } = get();
    const current = () => get().symbol === symbol && get().chartRevision === chartRevision && get().sessionId === sessionId && get().messages.length === 0;
    try {
      const { sessions } = await api.fetchSessions(symbol);
      const latest = sessions[0];
      if (!latest || !current()) return;
      const { messages } = await api.fetchSessionMessages(latest.id);
      if (messages.length === 0 || !current()) return;
      set({
        sessionId: latest.id,
        messages: messages.map((m) => ({ ...m })),
      });
    } catch {
      /* 无历史会话时保持新建的空会话 */
    }
  },
}));

/** 收藏状态在多个组件里都要判断，抽成一个选择器。 */
export function useIsWatched(symbol: string): boolean {
  return useWorkbench((state) => state.watchItems.some((item) => item.symbol === symbol && state.watchGroups.some(group => group.id === item.groupId && !group.managed)));
}
