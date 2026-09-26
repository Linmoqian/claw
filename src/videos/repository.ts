/** 视频副本与路径引用分开保存。Created on 2026-09-27 @author: https://github.com/Linmoqian */
import type { VideoResource } from "./types";

const DATABASE = "xiakao-video-resources";
let opening: Promise<IDBDatabase> | null = null;

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("视频资源读取失败"));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("视频资源保存中止"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("视频资源保存失败"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法保存视频资源"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("files");
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
      reject(request.error ?? new Error("无法打开视频资源库"));
    request.onblocked = () =>
      reject(new Error("视频资源库被其他窗口占用，请关闭旧窗口后重试"));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

function newRecord(
  fileName: string,
  source: VideoResource["source"],
): VideoResource {
  return {
    id: crypto.randomUUID(),
    name: fileName.replace(/\.[^.]+$/, ""),
    fileName,
    source,
    mimeType: null,
    sizeBytes: null,
    durationS: null,
    createdAt: new Date().toISOString(),
    path: null,
  };
}

export const videoRepository = {
  async list(): Promise<VideoResource[]> {
    const db = await openDatabase();
    const records = await resultOf<VideoResource[]>(
      db.transaction("records").objectStore("records").getAll(),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File, durationS: number | null): Promise<VideoResource> {
    const db = await openDatabase();
    const record: VideoResource = {
      ...newRecord(file.name, "import"),
      mimeType: file.type || null,
      sizeBytes: file.size,
      durationS,
    };
    const transaction = db.transaction(["records", "files"], "readwrite");
    const done = committed(transaction);
    try {
      transaction.objectStore("records").put(record);
      transaction.objectStore("files").put(file, record.id);
    } catch (error) {
      transaction.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
    return record;
  },

  async link(path: string): Promise<VideoResource> {
    const db = await openDatabase();
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const record: VideoResource = {
      ...newRecord(fileName, "path"),
      path,
    };
    const transaction = db.transaction("records", "readwrite");
    const done = committed(transaction);
    transaction.objectStore("records").put(record);
    await done;
    return record;
  },

  async file(id: string): Promise<Blob> {
    const db = await openDatabase();
    const file = await resultOf<Blob | undefined>(
      db.transaction("files").objectStore("files").get(id),
    );
    if (!file) throw new Error("视频副本未找到，请重新导入原文件");
    return file;
  },

  async remove(id: string): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(["records", "files"], "readwrite");
    const done = committed(transaction);
    transaction.objectStore("records").delete(id);
    transaction.objectStore("files").delete(id);
    await done;
  },
};
