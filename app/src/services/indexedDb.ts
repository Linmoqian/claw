// IndexedDB 访问的共享基础设施：库连接单例、请求/事务 Promise 化与写事务模板。
// 各业务仓库只提供库名、升级回调与业务校验，避免四处复制连接与事务样板。
// Created on 2026-09-29; Updated on 2026-09-29 @author: https://github.com/Linmoqian

export interface IndexedDatabaseOptions {
  /** 库名，同时作为连接单例的键 */
  name: string;
  /** 错误文案中的领域名，如「实验」「视频资源」 */
  label: string;
  /** 版本升级回调：创建/迁移 objectStore 与索引 */
  upgrade: (db: IDBDatabase) => void;
}

const openings = new Map<string, Promise<IDBDatabase>>();

/** 打开（或复用）指定库的连接；versionchange 时主动让位，下次调用重新打开 */
export function openIndexedDatabase(options: IndexedDatabaseOptions): Promise<IDBDatabase> {
  const cached = openings.get(options.name);
  if (cached) return cached;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error(`当前环境不支持 IndexedDB，无法保存${options.label}`));
      return;
    }
    const request = indexedDB.open(options.name, 1);
    request.onupgradeneeded = () => options.upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        openings.delete(options.name);
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error(`无法打开${options.label}库`));
    request.onblocked = () =>
      reject(new Error(`${options.label}库被其他窗口占用，请关闭旧窗口后重试`));
  });
  openings.set(options.name, opening);
  opening.catch(() => openings.delete(options.name));
  return opening;
}

/** 把单个 IDBRequest 转成 Promise；失败时优先保留原始错误 */
export function requestResult<T>(request: IDBRequest<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`${label}读取失败`));
  });
}

/** 等待事务提交完成；中止与失败都转为拒绝 */
export function committed(transaction: IDBTransaction, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${label}保存中止`));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`${label}保存失败`));
  });
}

/** 写事务模板：同步写入阶段抛错时先中止事务再上报，正常路径等待提交完成 */
export async function runWrite(
  db: IDBDatabase,
  stores: string[] | string,
  label: string,
  write: (transaction: IDBTransaction) => void,
): Promise<void> {
  const transaction = db.transaction(stores, "readwrite");
  const done = committed(transaction, label);
  try {
    write(transaction);
  } catch (error) {
    transaction.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}
