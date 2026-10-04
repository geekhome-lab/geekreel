import type { WsEvent } from "@vw/core";

export interface WsLike {
  send(data: string): void;
}

const clients = new Set<WsLike>();

export const wsHub = {
  add(ws: WsLike) {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "hello", now: Date.now() } satisfies WsEvent));
  },
  remove(ws: WsLike) {
    clients.delete(ws);
  },
  broadcast(event: WsEvent) {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      try {
        ws.send(data);
      } catch {
        clients.delete(ws);
      }
    }
  },
  get size() {
    return clients.size;
  },
};
