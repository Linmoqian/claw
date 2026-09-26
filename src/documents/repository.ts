/** PDF 与 Markdown 文档的本地副本仓库。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */

export type DocumentKind = "pdf" | "markdown";

export interface DocumentRecord {
  id: string;
  name: string;
  fileName: string;
  kind: DocumentKind;
  sizeBytes: number;
  createdAt: string;
}

const DATABASE = "xiakao-document-library";
let opening: Promise<IDBDatabase> | null = null;

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("文档读取失败"));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("文档保存中止"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("文档保存失败"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB，无法保存文档"));
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
      reject(request.error ?? new Error("无法打开文档库"));
    request.onblocked = () =>
      reject(new Error("文档库被其他窗口占用，请关闭旧窗口后重试"));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

function kindOf(fileName: string): DocumentKind | null {
  const lower = fileName.toLocaleLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return null;
}

async function validateFile(file: File): Promise<DocumentKind> {
  const kind = kindOf(file.name);
  if (!kind) throw new Error(`「${file.name}」不是 PDF 或 Markdown 文件`);
  if (file.size === 0) throw new Error(`「${file.name}」是空文件`);
  if (kind === "pdf") {
    const signature = await file.slice(0, 5).text();
    if (signature !== "%PDF-") {
      throw new Error(`「${file.name}」不是有效的 PDF 文件`);
    }
  }
  return kind;
}

export const documentRepository = {
  async list(): Promise<DocumentRecord[]> {
    const db = await openDatabase();
    const records = await resultOf<DocumentRecord[]>(
      db.transaction("records").objectStore("records").getAll(),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File): Promise<DocumentRecord> {
    const kind = await validateFile(file);
    const db = await openDatabase();
    const record: DocumentRecord = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      kind,
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
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

  async file(id: string): Promise<Blob> {
    const db = await openDatabase();
    const file = await resultOf<Blob | undefined>(
      db.transaction("files").objectStore("files").get(id),
    );
    if (!file) throw new Error("文档副本未找到，请重新导入原文件");
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
