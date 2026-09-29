/** PDF 与 Markdown 文档的本地副本仓库。Created on 2026-09-27; Updated on 2026-09-29 @author: https://github.com/Linmoqian */
import {
  openIndexedDatabase,
  requestResult,
  runWrite,
} from "../../../services/indexedDb";

export type DocumentKind = "pdf" | "markdown";

export interface DocumentRecord {
  id: string;
  name: string;
  fileName: string;
  kind: DocumentKind;
  sizeBytes: number;
  createdAt: string;
}

const LABEL = "文档";

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDatabase({
    name: "xiakao-document-library",
    label: LABEL,
    upgrade: (db) => {
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("files");
    },
  });
}

function kindOf(fileName: string): DocumentKind | null {
  const lower = fileName.toLocaleLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return null;
}

export async function validateDocumentFile(file: File): Promise<DocumentKind> {
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

export const indexedDbDocumentRepository = {
  async list(): Promise<DocumentRecord[]> {
    const db = await openDatabase();
    const records = await requestResult<DocumentRecord[]>(
      db.transaction("records").objectStore("records").getAll(),
      LABEL,
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File): Promise<DocumentRecord> {
    const kind = await validateDocumentFile(file);
    const db = await openDatabase();
    const record: DocumentRecord = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      kind,
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
    };
    await runWrite(db, ["records", "files"], LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
      transaction.objectStore("files").put(file, record.id);
    });
    return record;
  },

  async file(id: string): Promise<Blob> {
    const db = await openDatabase();
    const file = await requestResult<Blob | undefined>(
      db.transaction("files").objectStore("files").get(id),
      LABEL,
    );
    if (!file) throw new Error("文档副本未找到，请重新导入原文件");
    return file;
  },

  async remove(id: string): Promise<void> {
    const db = await openDatabase();
    await runWrite(db, ["records", "files"], LABEL, (transaction) => {
      transaction.objectStore("records").delete(id);
      transaction.objectStore("files").delete(id);
    });
  },
};
