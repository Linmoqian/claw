/**
 * transport —— 纯传输层：只负责「怎么传」，不理解业务内容。
 * Transport 接口极薄，便于将来换
COM / TCP / WebWorker 通道时 ConnectionManager 与本协议不变。
 */
export type Unsubscribe = () => void;

export interface Transport {
  readonly url: string;
  /** 发送原文；未连接时丢弃由调用方负责，内部不缓存 */
  send(text: string): void | Promise<void>;
  close(code?: number, reason?: string): void;
  onOpen(cb: () => void): Unsubscribe;
  onMessage(cb: (text: string) => void): Unsubscribe;
  onClose(cb: (e: { code: number; reason: string }) => void): Unsubscribe;
  onError(cb: (e: unknown) => void): Unsubscribe;
}

/** 建链工厂（每次重连新建一条 transport） */
export type TransportFactory = (url: string) => Transport;
