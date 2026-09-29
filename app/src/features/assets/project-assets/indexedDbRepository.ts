/** 项目资产副本与路径引用仓库。Created on 2026-09-27; Updated on 2026-09-29 @author: https://github.com/Linmoqian */
import { ASSET_KINDS, acceptsAsset, assetKind, type ProjectAssetKind, type ProjectAssetRecord } from "./types";
import {
  openIndexedDatabase,
  requestResult,
  runWrite,
} from "../../../services/indexedDb";

const LABEL = "项目资产";

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDatabase({
    name: "xiakao-project-assets",
    label: LABEL,
    upgrade: (db) => {
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("files");
    },
  });
}

export function validateAssetName(fileName: string, kind: ProjectAssetKind): void {
  if (!acceptsAsset(fileName, kind)) {
    throw new Error(`「${fileName}」不属于${assetKind(kind).label}；支持 ${assetKind(kind).extensions.map((extension) => `.${extension}`).join("、")}`);
  }
}

export function assetRecordOf(fileName: string, kind: ProjectAssetKind, source: ProjectAssetRecord["source"]): ProjectAssetRecord {
  return {
    id: crypto.randomUUID(),
    name: fileName.replace(/\.[^.]+$/, ""),
    fileName,
    kind,
    source,
    sizeBytes: null,
    path: null,
    createdAt: new Date().toISOString(),
  };
}

export async function validateAssetFile(file: File, kind: ProjectAssetKind): Promise<void> {
  validateAssetName(file.name, kind);
  if (file.size === 0) throw new Error(`「${file.name}」是空文件`);
  if (kind === "algorithm") {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const zipHeader = signature[0] === 0x50 && signature[1] === 0x4b && (
      (signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08)
    );
    if (!zipHeader) throw new Error(`「${file.name}」不是有效的 ZIP 归档`);
  }
}

export function validateAssetPath(path: string, kind: ProjectAssetKind): { value: string; fileName: string } {
  const value = path.trim();
  if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value)) throw new Error("请选择文件的完整路径");
  const fileName = value.split(/[\\/]/).pop() ?? "";
  validateAssetName(fileName, kind);
  return { value, fileName };
}

function isRecord(value: unknown): value is ProjectAssetRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ProjectAssetRecord>;
  return typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.fileName === "string" &&
    ASSET_KINDS.some((kind) => kind.id === record.kind) &&
    (record.source === "copy" || record.source === "path") &&
    (record.sizeBytes === null || typeof record.sizeBytes === "number") &&
    (record.path === null || typeof record.path === "string") &&
    typeof record.createdAt === "string";
}

export const indexedDbProjectAssetRepository = {
  async list(): Promise<ProjectAssetRecord[]> {
    const db = await openDatabase();
    const records = await requestResult<unknown[]>(
      db.transaction("records").objectStore("records").getAll(),
      LABEL,
    );
    if (!records.every(isRecord)) throw new Error("部分资产记录无法读取，原始内容已保留；请修复后重试");
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async import(file: File, kind: ProjectAssetKind): Promise<ProjectAssetRecord> {
    await validateAssetFile(file, kind);
    const db = await openDatabase();
    const record: ProjectAssetRecord = {
      ...assetRecordOf(file.name, kind, "copy"),
      sizeBytes: file.size,
    };
    await runWrite(db, ["records", "files"], LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
      transaction.objectStore("files").put(file, record.id);
    });
    return record;
  },

  async link(path: string, kind: ProjectAssetKind): Promise<ProjectAssetRecord> {
    const { value, fileName } = validateAssetPath(path, kind);
    const db = await openDatabase();
    const record: ProjectAssetRecord = {
      ...assetRecordOf(fileName, kind, "path"),
      path: value,
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
    if (!file) throw new Error("资产副本未找到，请重新导入原文件");
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
