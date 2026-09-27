/** 视频仓库边界：桌面分块落盘，浏览器预览沿用原仓库。Created on 2026-09-28
 * @author:  https://github.com/Linmoqian
 */
import { isDesktopStorage, listDesktopRecords, migrateDesktopBucket, readDesktopFile, removeDesktopRecord, saveDesktopLink, uploadDesktopFile } from "../desktopStorage";
import { indexedDbVideoRepository } from "./indexedDbRepository";
import type { VideoResource } from "./types";

const BUCKET = "videos";

function newRecord(fileName: string, source: VideoResource["source"]): VideoResource {
  return {
    id: crypto.randomUUID(), name: fileName.replace(/\.[^.]+$/, ""), fileName, source,
    mimeType: null, sizeBytes: null, durationS: null,
    createdAt: new Date().toISOString(), path: null,
  };
}

async function migrate(): Promise<void> {
  await migrateDesktopBucket(BUCKET, indexedDbVideoRepository.list, async (record) => {
    if (record.source === "path") await saveDesktopLink(BUCKET, record);
    else await uploadDesktopFile(BUCKET, record, await indexedDbVideoRepository.file(record.id));
  });
}

export const videoRepository = {
  async list(): Promise<VideoResource[]> {
    if (!isDesktopStorage()) return indexedDbVideoRepository.list();
    await migrate();
    return (await listDesktopRecords<VideoResource>(BUCKET)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File, durationS: number | null): Promise<VideoResource> {
    if (!isDesktopStorage()) return indexedDbVideoRepository.import(file, durationS);
    await migrate();
    const record: VideoResource = {
      ...newRecord(file.name, "import"), mimeType: file.type || null,
      sizeBytes: file.size, durationS,
    };
    await uploadDesktopFile(BUCKET, record, file);
    return record;
  },

  async link(path: string): Promise<VideoResource> {
    if (!isDesktopStorage()) return indexedDbVideoRepository.link(path);
    await migrate();
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const record: VideoResource = { ...newRecord(fileName, "path"), path };
    await saveDesktopLink(BUCKET, record);
    return record;
  },

  async file(id: string): Promise<Blob> {
    if (!isDesktopStorage()) return indexedDbVideoRepository.file(id);
    await migrate();
    const record = (await listDesktopRecords<VideoResource>(BUCKET)).find((item) => item.id === id);
    if (!record) throw new Error("视频副本未找到，请重新导入原文件");
    return readDesktopFile(BUCKET, id, record.mimeType ?? "video/mp4");
  },

  async remove(id: string): Promise<void> {
    if (!isDesktopStorage()) return indexedDbVideoRepository.remove(id);
    await migrate();
    await removeDesktopRecord(BUCKET, id);
  },
};
