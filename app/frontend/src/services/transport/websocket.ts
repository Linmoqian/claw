/**
 * websocket —— WebSocket 传输实现（浏览器原生 / Node 22+ global 均可用）。
 * WS 生命周期与协议无关，把原生事件微整形后交给 ConnectionManager。
 */
import type { Transport, Unsubscribe } from "./types";
import { isTauri } from "@tauri-apps/api/core";
import { DesktopWebSocketTransport } from "./desktopWebsocket";

type Listeners<V> = Set<(value: V) => void>;

const OPEN = 1;

export class WebSocketTransport implements Transport {
  readonly url: string;
  private ws: WebSocket | null = null;
  private readonly openListeners: Listeners<void> = new Set();
  private readonly messageListeners: Listeners<string> = new Set();
  private readonly closeListeners: Listeners<{ code: number; reason: string }> =
    new Set();
  private readonly errorListeners: Listeners<unknown> = new Set();

  /** 构造即建链（工厂语义：造出即开始连接），open 幂等 */
  constructor(url: string) {
    this.url = url;
    this.open();
  }

  /** 建立连接（创建即同步 open，失败以 onError 报告） */
  open(): void {
    if (this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const cb of this.openListeners) cb();
    };
    ws.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === "string" ? e.data : String(e.data);
      for (const cb of this.messageListeners) cb(text);
    };
    ws.onclose = (e: CloseEvent) => {
      for (const cb of this.closeListeners) {
        cb({ code: e.code, reason: e.reason });
      }
    };
    ws.onerror = (e: Event) => {
      for (const cb of this.errorListeners) cb(e);
    };
  }

  send(text: string): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(text);
  }

  close(code = 1000, reason = ""): void {
    if (!this.ws) return;
    try {
      this.ws.close(code, reason);
    } catch {
      // 已断开或未开放时 close 会抛，忽略交回状态机
    }
  }

  onOpen(cb: () => void): Unsubscribe {
    this.openListeners.add(cb);
    return () => this.openListeners.delete(cb);
  }

  onMessage(cb: (text: string) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onClose(cb: (e: { code: number; reason: string }) => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  onError(cb: (e: unknown) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }
}

/** 默认工厂：浏览器/Node 共享 */
export function createWebSocketTransportFactory(): (
  url: string,
) => Transport {
  return (url: string) => isTauri()
    ? new DesktopWebSocketTransport(url)
    : new WebSocketTransport(url);
}
