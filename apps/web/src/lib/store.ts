import { create } from "zustand";
import type { Job, WsEvent } from "@vw/core";

interface AppState {
  wsConnected: boolean;
  /** WS 推送的实时任务状态（id → job） */
  liveJobs: Record<string, Job>;
  currentProjectId: string | null;
  setCurrentProject(id: string | null): void;
}

export const useAppStore = create<AppState>((set) => ({
  wsConnected: false,
  liveJobs: {},
  currentProjectId: localStorage.getItem("vw.currentProjectId"),
  setCurrentProject: (id) => {
    if (id) localStorage.setItem("vw.currentProjectId", id);
    else localStorage.removeItem("vw.currentProjectId");
    set({ currentProjectId: id });
  },
}));

// ---------------------------------------------------------------------------
// WS 客户端：自动重连 + 事件订阅
// ---------------------------------------------------------------------------

type Listener = (ev: WsEvent) => void;
const listeners = new Set<Listener>();

export function onWsEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let retryMs = 1000;
let started = false;

export function connectWs() {
  if (started) return;
  started = true;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retryMs = 1000;
      useAppStore.setState({ wsConnected: true });
    };
    ws.onclose = () => {
      useAppStore.setState({ wsConnected: false });
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as WsEvent;
        if (ev.type === "job.upsert") {
          useAppStore.setState((s) => ({ liveJobs: { ...s.liveJobs, [ev.job.id]: ev.job } }));
        }
        for (const cb of listeners) cb(ev);
      } catch {
        /* 忽略无法解析的消息 */
      }
    };
  };
  open();
}
