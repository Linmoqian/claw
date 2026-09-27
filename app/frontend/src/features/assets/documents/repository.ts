/** 文档仓库边界：桌面分块落盘并保留旧 IndexedDB 备份。Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { isDesktopStorage, listDesktopRecords, migrateDesktopBucket, readDesktopFile, removeDesktopRecord, uploadDesktopFile } from "../desktopStorage";
import { indexedDbDocumentRepository, validateDocumentFile } from "./indexedDbRepository";
import type { DocumentRecord } from "./indexedDbRepository";

export type { DocumentKind, DocumentRecord } from "./indexedDbRepository";

const BUCKET = "documents";

async function migrate(): Promise<void> {
  await migrateDesktopBucket(BUCKET, indexedDbDocumentRepository.list, async (record) => {
    await uploadDesktopFile(BUCKET, record, await indexedDbDocumentRepository.file(record.id));
  });
}

export const documentRepository = {
  async list(): Promise<DocumentRecord[]> {
    if (!isDesktopStorage()) return indexedDbDocumentRepository.list();
    await migrate();
    return (await listDesktopRecords<DocumentRecord>(BUCKET)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File): Promise<DocumentRecord> {
    if (!isDesktopStorage()) return indexedDbDocumentRepository.import(file);
    await migrate();
    const kind = await validateDocumentFile(file);
    const record: DocumentRecord = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      kind,
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
    };
    await uploadDesktopFile(BUCKET, record, file);
    return record;
  },

  async file(id: string): Promise<Blob> {
    if (!isDesktopStorage()) return indexedDbDocumentRepository.file(id);
    await migrate();
    const record = (await listDesktopRecords<DocumentRecord>(BUCKET)).find((item) => item.id === id);
    if (!record) throw new Error("文档副本未找到，请重新导入原文件");
    return readDesktopFile(BUCKET, id, record.kind === "pdf" ? "application/pdf" : "text/markdown");
  },

  async remove(id: string): Promise<void> {
    if (!isDesktopStorage()) return indexedDbDocumentRepository.remove(id);
    await migrate();
    await removeDesktopRecord(BUCKET, id);
  },
};
