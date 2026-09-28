/** 视频、文档与项目文件的统一资产入口。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Box,
  BrainCircuit,
  CircleAlert,
  Clapperboard,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Search,
  Trash2,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import LoadingState from "../../../components/workbench/LoadingState";
import { formatBytes, formatDate } from "../../../components/workbench/format";
import { documentRepository, type DocumentRecord } from "../documents/repository";
import { isDesktop } from "../../../lib/serial";
import { isVideoName, readVideoDuration, VIDEO_ACCEPT, VIDEO_EXTENSIONS } from "../videos/file";
import { videoRepository } from "../videos/repository";
import type { VideoResource } from "../videos/types";
import { projectAssetRepository } from "../project-assets/repository";
import { ASSET_KINDS, type ProjectAssetKind, type ProjectAssetRecord } from "../project-assets/types";
import "./AssetLibrary.css";

type LibraryKind = "video" | "document" | ProjectAssetKind;
type KindFilter = "all" | LibraryKind;
interface LibraryItem {
  key: string;
  id: string;
  kind: LibraryKind;
  name: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: string;
  source: "copy" | "path";
  path: string | null;
}
const ICONS: Record<LibraryKind, LucideIcon> = {
  video: Clapperboard,
  document: BookOpen,
  "training-data": Database,
  "model-weights": BrainCircuit,
  "3d-model": Box,
  algorithm: FileArchive,
};
const LIBRARY_KINDS: { id: LibraryKind; label: string; description: string; extensions: string[] }[] = [
  { id: "video", label: "视频资源", description: "实验录像与演示视频", extensions: VIDEO_EXTENSIONS },
  { id: "document", label: "文档收集", description: "PDF 与 Markdown", extensions: ["pdf", "md", "markdown"] },
  ...ASSET_KINDS,
];
function libraryKind(id: LibraryKind) {
  return LIBRARY_KINDS.find((kind) => kind.id === id)!;
}

export default function AssetLibrary() {
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([]);
  const [videos, setVideos] = useState<VideoResource[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadKind, setUploadKind] = useState<LibraryKind>("video");
  const [filter, setFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const desktop = isDesktop();

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      projectAssetRepository.list(),
      videoRepository.list(),
      documentRepository.list(),
    ]).then(([assetResult, videoResult, documentResult]) => {
      if (cancelled) return;
      const failures: string[] = [];
      if (assetResult.status === "fulfilled") setAssets(assetResult.value);
      else failures.push(`项目文件：${String(assetResult.reason)}`);
      if (videoResult.status === "fulfilled") setVideos(videoResult.value);
      else failures.push(`视频：${String(videoResult.reason)}`);
      if (documentResult.status === "fulfilled") setDocuments(documentResult.value);
      else failures.push(`文档：${String(documentResult.reason)}`);
      if (failures.length) setError(`资产读取失败：${failures.join("；")}`);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const items = useMemo<LibraryItem[]>(() => [
    ...videos.map((video) => ({
      key: `video:${video.id}`, id: video.id, kind: "video" as const,
      name: video.name, fileName: video.fileName, sizeBytes: video.sizeBytes,
      createdAt: video.createdAt, source: video.source === "import" ? "copy" as const : "path" as const,
      path: video.path,
    })),
    ...documents.map((record) => ({
      key: `document:${record.id}`, id: record.id, kind: "document" as const,
      name: record.name, fileName: record.fileName, sizeBytes: record.sizeBytes,
      createdAt: record.createdAt, source: "copy" as const, path: null,
    })),
    ...assets.map((asset) => ({
      key: `asset:${asset.id}`, id: asset.id, kind: asset.kind,
      name: asset.name, fileName: asset.fileName, sizeBytes: asset.sizeBytes,
      createdAt: asset.createdAt, source: asset.source, path: asset.path,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [assets, documents, videos]);
  const counts = useMemo(() => Object.fromEntries(
    LIBRARY_KINDS.map((kind) => [kind.id, items.filter((item) => item.kind === kind.id).length]),
  ) as Record<LibraryKind, number>, [items]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter((item) =>
      (filter === "all" || item.kind === filter) &&
      (!query || `${item.name} ${item.fileName}`.toLocaleLowerCase().includes(query)),
    );
  }, [filter, items, search]);

  const refresh = async () => {
    const [assetResult, videoResult, documentResult] = await Promise.allSettled([
      projectAssetRepository.list(), videoRepository.list(), documentRepository.list(),
    ]);
    const failures: string[] = [];
    if (assetResult.status === "fulfilled") setAssets(assetResult.value);
    else failures.push(`项目文件：${String(assetResult.reason)}`);
    if (videoResult.status === "fulfilled") setVideos(videoResult.value);
    else failures.push(`视频：${String(videoResult.reason)}`);
    if (documentResult.status === "fulfilled") setDocuments(documentResult.value);
    else failures.push(`文档：${String(documentResult.reason)}`);
    setError(failures.length ? `资产读取失败：${failures.join("；")}` : null);
    setLoading(false);
  };

  const importFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    let saved = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        if (uploadKind === "video") {
          if (!isVideoName(file.name, file.type)) throw new Error(`「${file.name}」不是受支持的视频文件`);
          if (file.size === 0) throw new Error(`「${file.name}」是空文件`);
          await videoRepository.import(file, await readVideoDuration(file));
        } else if (uploadKind === "document") {
          await documentRepository.import(file);
        } else {
          await projectAssetRepository.import(file, uploadKind);
        }
        saved++;
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : String(reason));
      }
    }
    await refresh();
    if (saved) {
      setFilter(uploadKind);
      setNotice(`已保存 ${saved} 份${libraryKind(uploadKind).label}到当前设备。`);
    }
    if (failures.length) setError(`导入未完成：${failures.join("；")}${uploadKind === "document" ? "" : "。大文件可在桌面端引用原路径"}。`);
    setBusy(false);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void importFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };

  const choosePath = async () => {
    if (!desktop || busy || uploadKind === "document") return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: libraryKind(uploadKind).label, extensions: libraryKind(uploadKind).extensions }],
      });
      if (typeof chosen === "string") {
        if (uploadKind === "video") {
          if (!isVideoName(chosen) || !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(chosen))
            throw new Error("请选择受支持视频文件的完整路径");
          await videoRepository.link(chosen);
        } else {
          await projectAssetRepository.link(chosen, uploadKind);
        }
        await refresh();
        setFilter(uploadKind);
        setNotice("已保存文件路径引用，原文件仍在原位置。");
      }
    } catch (reason) {
      setError(`路径引用未保存：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const download = async (asset: LibraryItem) => {
    try {
      const file = asset.kind === "video"
        ? await videoRepository.file(asset.id)
        : asset.kind === "document"
          ? await documentRepository.file(asset.id)
          : await projectAssetRepository.file(asset.id);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) {
      setError(`下载失败：${String(reason)}`);
    }
  };

  const reveal = async (asset: LibraryItem) => {
    if (!desktop || !asset.path) return;
    try {
      await revealItemInDir(asset.path);
    } catch (reason) {
      setError(`无法定位原文件：${String(reason)}。请检查路径是否仍然有效。`);
    }
  };

  const remove = async (asset: LibraryItem) => {
    const detail = asset.source === "copy" ? "这会删除工作台保存的文件副本。" : "这只会移除路径引用，原文件不会删除。";
    if (!window.confirm(`移除「${asset.fileName}」？${detail}`)) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (asset.kind === "video") await videoRepository.remove(asset.id);
      else if (asset.kind === "document") await documentRepository.remove(asset.id);
      else await projectAssetRepository.remove(asset.id);
      await refresh();
      setNotice(`已移除「${asset.fileName}」。`);
    } catch (reason) {
      setError(`移除失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage asset-library">
      <header className="asset-library__header">
        <span className="section-label">数据与智能</span>
        <h1>项目资产</h1>
        <p>把实验视频、文档、数据、权重、模型与算法归到同一工作台。直接收纳文件，按类型快速查找与打开。</p>
      </header>

      <section className="asset-library__categories" aria-label="资产分类">
        {LIBRARY_KINDS.map((kind) => {
          const Icon = ICONS[kind.id];
          return (
            <button
              key={kind.id}
              type="button"
              className={`asset-library__category${filter === kind.id ? " is-active" : ""}`}
              onClick={() => { setFilter(kind.id); setUploadKind(kind.id); }}
            >
              <Icon size={22} aria-hidden="true" />
              <strong>{kind.label}</strong>
              <span>{kind.description}</span>
              <small>{counts[kind.id]} 项 · 查看分类</small>
            </button>
          );
        })}
      </section>

      <section
        className={`asset-library__dropzone${dragging ? " is-dragging" : ""}`}
        aria-label="导入项目资产"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <UploadCloud size={24} aria-hidden="true" />
        <div className="asset-library__drop-copy">
          <strong>添加到项目资产</strong>
          <span>{uploadKind === "document" ? "PDF 与 Markdown 保存到文档库，可在阅读器中查看。" : "先选类型，再拖入或选择文件；大文件可在桌面端引用原路径。"}</span>
        </div>
        <label className="asset-library__kind-select">
          <span>资产类型</span>
          <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as LibraryKind)} disabled={busy}>
            {LIBRARY_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept={uploadKind === "video" ? VIDEO_ACCEPT : libraryKind(uploadKind).extensions.map((extension) => `.${extension}`).join(",")}
          multiple
          hidden
          onChange={handleInput}
        />
        <button type="button" className="asset-library__button is-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {busy ? <LoaderCircle className="asset-library__spin" size={16} /> : <FilePlus2 size={16} />}
          {busy ? "正在保存…" : "导入副本"}
        </button>
        {desktop && uploadKind !== "document" && (
          <button type="button" className="asset-library__button" disabled={busy} onClick={() => void choosePath()}>
            <FolderOpen size={16} /> 引用原文件
          </button>
        )}
      </section>
      <p className="asset-library__format-note">
        支持：{libraryKind(uploadKind).extensions.map((extension) => `.${extension}`).join("、")}。
        {uploadKind === "algorithm" ? "算法 ZIP 只归档，不自动解压或执行。" : uploadKind === "document" ? "文档可在阅读器中查看 PDF 与 Markdown。" : uploadKind === "video" ? "视频可在视频库中预览；路径引用仅在桌面端定位。" : ""}
      </p>

      {notice && <p className="asset-library__notice" role="status">{notice}</p>}
      {error && (
        <div className="asset-library__error" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>重试读取</button>
        </div>
      )}

      <section className="asset-library__panel" aria-label="项目资产列表">
        <div className="asset-library__panel-head">
          <div>
            <span className="asset-library__eyebrow">PROJECT FILES</span>
            <h2>已归档资产 <small>{items.length}</small></h2>
          </div>
          <label className="asset-library__search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资产名称" aria-label="搜索资产名称" />
          </label>
        </div>
        <div className="asset-library__filters" aria-label="资产类型筛选">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部</button>
          {LIBRARY_KINDS.map((kind) => (
            <button key={kind.id} type="button" aria-pressed={filter === kind.id} onClick={() => setFilter(kind.id)}>
              {kind.label} <span>{counts[kind.id]}</span>
            </button>
          ))}
        </div>
        {loading ? (
          <LoadingState label="正在读取项目资产" detail="从当前设备的资产库加载" variant="panel" />
        ) : visible.length ? (
          <div className="asset-library__list">
            {visible.map((asset) => {
              const Icon = ICONS[asset.kind];
              return (
                <article className="asset-library__item" key={asset.key}>
                  <span className={`asset-library__file-icon is-${asset.kind}`}><Icon size={21} aria-hidden="true" /></span>
                  <div className="asset-library__item-copy">
                    <strong title={asset.fileName}>{asset.name}</strong>
                    <span>{libraryKind(asset.kind).label} · {asset.fileName} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.createdAt)}</span>
                    {asset.source === "path" && <small title={asset.path ?? ""}>路径引用 · {asset.path}</small>}
                  </div>
                  <div className="asset-library__item-actions">
                    {asset.kind === "video" && (
                      <Link className="asset-library__button" to={`/data?video=${encodeURIComponent(asset.id)}`}><Clapperboard size={15} /> {asset.source === "copy" ? "预览" : "查看路径"}</Link>
                    )}
                    {asset.kind === "document" && (
                      <Link className="asset-library__button" to={`/documents?document=${encodeURIComponent(asset.id)}`}><BookOpen size={15} /> 阅读</Link>
                    )}
                    {asset.source === "copy" ? (
                      <button type="button" className="asset-library__button" onClick={() => void download(asset)}><Download size={15} /> 下载</button>
                    ) : desktop ? (
                      <button type="button" className="asset-library__button" onClick={() => void reveal(asset)}><ExternalLink size={15} /> 定位</button>
                    ) : null}
                    <button type="button" className="asset-library__remove" aria-label={`移除${asset.fileName}`} title="移除资产" disabled={busy} onClick={() => void remove(asset)}><Trash2 size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="asset-library__empty">
            <FileArchive size={29} aria-hidden="true" />
            <strong>{items.length ? "没有匹配的资产" : "项目资产库还是空的"}</strong>
            <p>{items.length ? "试试其他关键词或分类。" : "选择资产类型并导入文件，开始整理项目资料。"}</p>
          </div>
        )}
      </section>
    </div>
  );
}
