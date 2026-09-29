/** 视频副本与路径引用分开保存。Created on 2026-09-27; Updated on 2026-09-29 @author: https://github.com/Linmoqian */
import {
  openIndexedDatabase,
  requestResult,
  runWrite,
} from "../../../services/indexedDb";
import type { VideoResource } from "./types";

const LABEL = "视频资源";

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDatabase({
    name: "xiakao-video-resources",
    label: LABEL,
    upgrade: (db) => {
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("files");
    },
  });
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

export const indexedDbVideoRepository = {
  async list(): Promise<VideoResource[]> {
    const db = await openDatabase();
    const records = await requestResult<VideoResource[]>(
      db.transaction("records").objectStore("records").getAll(),
      LABEL,
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
    await runWrite(db, ["records", "files"], LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
      transaction.objectStore("files").put(file, record.id);
    });
    return record;
  },

  async link(path: string): Promise<VideoResource> {
    const db = await openDatabase();
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const record: VideoResource = {
      ...newRecord(fileName, "path"),
      path,
    };
    await runWrite(db, "records", LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
    });
    return record;
  },

  async file(id: string): Promise<Blob> {
    const db = await openDatabase();
    const file = await requestResult<Blob | undefined>(
      db.transaction("files").objectStore("files").get(id),
      LABEL,
    );
    if (!file) throw new Error("视频副本未找到，请重新导入原文件");
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
