/** 验证控制发送失败沿连接层返回。Created on 2026-09-28
 * Updated on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
import { ConnectionManager } from "../../../app/frontend/src/services/connection/connectionManager";
import type { Transport, Unsubscribe } from "../../../app/frontend/src/services/transport/types";

class FailingTransport implements Transport {
  readonly url = "ws://127.0.0.1:1";
  private readonly openListeners = new Set<() => void>();

  onOpen(listener: () => void): Unsubscribe {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }
  onMessage(): Unsubscribe { return () => undefined; }
  onClose(): Unsubscribe { return () => undefined; }
  onError(): Unsubscribe { return () => undefined; }
  close(): void { /* 验证替身没有实际连接。 */ }
  async send(): Promise<void> { throw new Error("后端发送队列已满"); }
  open(): void { for (const listener of this.openListeners) listener(); }
}

const transport = new FailingTransport();
const manager = new ConnectionManager(() => transport, transport.url, {
  autoReconnect: false,
  heartbeatMs: 0,
});
manager.start();
await assert.rejects(manager.send("control"), /尚未连接/);
transport.open();
await assert.rejects(manager.send("control"), /后端发送队列已满/);
manager.stop();
await assert.rejects(manager.send("control"), /尚未连接/);
console.log("[transport] disconnected and asynchronous send failures verified");
