/** 原生 IndexedDB 实验仓库：元信息、快照和采样分块在同一事务提交。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import type {
  ExperimentBundle,
  ExperimentRecord,
  ExperimentSample,
  ExperimentSnapshot,
} from "./types";

const DATABASE = "xiakao-experiments";
let opening: Promise<IDBDatabase> | null = null;

interface SampleChunk {
  recordId: string;
  offset: number;
  samples: ExperimentSample[];
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("实验数据库读取失败"));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("实验保存事务中止"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("实验保存失败"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法保存实验"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("snapshots");
      const chunks = db.createObjectStore("chunks", {
        keyPath: ["recordId", "offset"],
      });
      chunks.createIndex("recordId", "recordId");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开实验数据库"));
    request.onblocked = () =>
      reject(new Error("实验数据库被其他窗口占用，请关闭旧窗口后重试"));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

export const experimentRepository = {
  async list(): Promise<ExperimentRecord[]> {
    const db = await openDatabase();
    const records = await requestResult<ExperimentRecord[]>(
      db.transaction("records").objectStore("records").getAll(),
    );
    return records.sort((a, b) => b.createdAt - a.createdAt);
  },

  async write(
    record: ExperimentRecord,
    snapshot: ExperimentSnapshot,
    samples: ExperimentSample[],
    offset: number,
  ): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(
      ["records", "snapshots", "chunks"],
      "readwrite",
    );
    const done = committed(transaction);
    try {
      transaction.objectStore("records").put(record);
      transaction.objectStore("snapshots").put(snapshot, record.id);
      if (samples.length) {
        const chunk: SampleChunk = { recordId: record.id, offset, samples };
        transaction.objectStore("chunks").put(chunk);
      }
    } catch (error) {
      transaction.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  },

  async get(id: string): Promise<ExperimentBundle | null> {
    const db = await openDatabase();
    const transaction = db.transaction(["records", "snapshots", "chunks"]);
    const [record, snapshot, chunks] = await Promise.all([
      requestResult<ExperimentRecord | undefined>(
        transaction.objectStore("records").get(id),
      ),
      requestResult<ExperimentSnapshot | undefined>(
        transaction.objectStore("snapshots").get(id),
      ),
      requestResult<SampleChunk[]>(
        transaction.objectStore("chunks").index("recordId").getAll(id),
      ),
    ]);
    if (!record || !snapshot) return null;
    const samples = chunks
      .sort((a, b) => a.offset - b.offset)
      .flatMap((chunk) => chunk.samples);
    return { record, snapshot, samples };
  },

  async updateRecord(record: ExperimentRecord): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction("records", "readwrite");
    const done = committed(transaction);
    transaction.objectStore("records").put(record);
    await done;
  },
};
