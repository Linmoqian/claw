/** 桌面 WebSocket 只经 Rust 建链和收发；界面沿用同一传输接口。
 * Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Transport, Unsubscribe } from "./types";

interface DesktopWebSocketEvent {
  kind: "open" | "message" | "close" | "closed" | "error";
  text: string | null;
  code: number | null;
  reason: string | null;
  message: string | null;
}

type Listeners<T> = Set<(value: T) => void>;

export class DesktopWebSocketTransport implements Transport {
  readonly url: string;
  private id: number | null = null;
  private closed = false;
  private opened = false;
  private readonly pending: string[] = [];
  private readonly openListeners: Listeners<void> = new Set();
  private readonly messageListeners: Listeners<string> = new Set();
  private readonly closeListeners: Listeners<{ code: number; reason: string }> = new Set();
  private readonly errorListeners: Listeners<unknown> = new Set();

  constructor(url: string) {
    this.url = url;
    const channel = new Channel<DesktopWebSocketEvent>();
    channel.onmessage = (event) => {
      if (this.closed) return;
      if (event.kind === "open") {
        this.opened = true;
        for (const listener of this.openListeners) listener();
      } else if (event.kind === "message" && event.text !== null) {
        for (const listener of this.messageListeners) listener(event.text);
      } else if (event.kind === "error") {
        for (const listener of this.errorListeners)
          listener(new Error(event.message ?? "WebSocket 连接失败"));
      } else if (event.kind === "close" || event.kind === "closed") {
        this.closed = true;
        this.opened = false;
        for (const listener of this.closeListeners)
          listener({ code: event.code ?? 1006, reason: event.reason ?? "连接关闭" });
      }
    };
    void invoke<number>("websocket_open", { url, channel })
      .then(async (id) => {
        if (this.closed) await invoke("websocket_close", { id });
        else {
          this.id = id;
          for (const text of this.pending) this.send(text);
          this.pending.length = 0;
        }
      })
      .catch((error: unknown) => {
        if (this.closed) return;
        for (const listener of this.errorListeners) listener(error);
        for (const listener of this.closeListeners)
          listener({ code: 1006, reason: String(error) });
      });
  }

  send(text: string): void {
    if (!this.opened || this.closed) return;
    if (this.id === null) {
      if (this.pending.length < 64) this.pending.push(text);
      return;
    }
    void invoke("websocket_send", { id: this.id, text }).catch((error: unknown) => {
      for (const listener of this.errorListeners) listener(error);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.opened = false;
    if (this.id !== null) void invoke("websocket_close", { id: this.id });
  }

  onOpen(cb: () => void): Unsubscribe {
    this.openListeners.add(cb);
    return () => this.openListeners.delete(cb);
  }

  onMessage(cb: (text: string) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onClose(cb: (event: { code: number; reason: string }) => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  onError(cb: (error: unknown) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }
}
