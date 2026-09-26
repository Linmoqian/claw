/** 统一项目资产入口及四类文件归档。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
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
import LoadingState from "../components/workbench/LoadingState";
import { documentRepository } from "../documents/repository";
import { isDesktop } from "../lib/serial";
import { videoRepository } from "../videos/repository";
import { projectAssetRepository } from "../project-assets/repository";
import { ASSET_KINDS, assetKind, type ProjectAssetKind, type ProjectAssetRecord } from "../project-assets/types";
import "./AssetLibrary.css";

type KindFilter = "all" | ProjectAssetKind;
const ICONS: Record<ProjectAssetKind, LucideIcon> = {
  "training-data": Database,
  "model-weights": BrainCircuit,
  "3d-model": Box,
  algorithm: FileArchive,
};

function formatBytes(value: number | null): string {
  if (value === null) return "原文件路径";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function AssetLibrary() {
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([]);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadKind, setUploadKind] = useState<ProjectAssetKind>("training-data");
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
      if (assetResult.status === "fulfilled") setAssets(assetResult.value);
      else setError(`项目资产读取失败：${String(assetResult.reason)}`);
      if (videoResult.status === "fulfilled") setVideoCount(videoResult.value.length);
      if (documentResult.status === "fulfilled") setDocumentCount(documentResult.value.length);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => Object.fromEntries(
    ASSET_KINDS.map((kind) => [kind.id, assets.filter((asset) => asset.kind === kind.id).length]),
  ) as Record<ProjectAssetKind, number>, [assets]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return assets.filter((asset) =>
      (filter === "all" || asset.kind === filter) &&
      (!query || `${asset.name} ${asset.fileName}`.toLocaleLowerCase().includes(query)),
    );
  }, [assets, filter, search]);

  const refresh = async () => {
    try {
      setAssets(await projectAssetRepository.list());
      setError(null);
    } catch (reason) {
      setError(`项目资产读取失败：${String(reason)}`);
    } finally {
      setLoading(false);
    }
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
        await projectAssetRepository.import(file, uploadKind);
        saved++;
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : String(reason));
      }
    }
    await refresh();
    if (saved) {
      setFilter(uploadKind);
      setNotice(`已保存 ${saved} 份${assetKind(uploadKind).label}到当前设备。`);
    }
    if (failures.length) setError(`导入未完成：${failures.join("；")}。大文件可在桌面端引用原路径。`);
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
    if (!desktop || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: assetKind(uploadKind).label, extensions: assetKind(uploadKind).extensions }],
      });
      if (typeof chosen === "string") {
        await projectAssetRepository.link(chosen, uploadKind);
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

  const download = async (asset: ProjectAssetRecord) => {
    try {
      const file = await projectAssetRepository.file(asset.id);
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

  const reveal = async (asset: ProjectAssetRecord) => {
    if (!desktop || !asset.path) return;
    try {
      await revealItemInDir(asset.path);
    } catch (reason) {
      setError(`无法定位原文件：${String(reason)}。请检查路径是否仍然有效。`);
    }
  };

  const remove = async (asset: ProjectAssetRecord) => {
    const detail = asset.source === "copy" ? "这会删除工作台保存的文件副本。" : "这只会移除路径引用，原文件不会删除。";
    if (!window.confirm(`移除「${asset.fileName}」？${detail}`)) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await projectAssetRepository.remove(asset.id);
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
        <p>把实验视频、文档、数据、权重、模型与算法归到同一工作台。文件归档在当前设备，按类型快速查找。</p>
      </header>

      <section className="asset-library__categories" aria-label="资产分类">
        <Link to="/data" className="asset-library__category">
          <Clapperboard size={22} aria-hidden="true" />
          <strong>视频资源</strong>
          <span>实验录像与演示视频</span>
          <small>{videoCount === null ? "前往查看" : `${videoCount} 项 · 前往查看`}</small>
        </Link>
        <Link to="/documents" className="asset-library__category">
          <BookOpen size={22} aria-hidden="true" />
          <strong>文档收集</strong>
          <span>PDF 与 Markdown</span>
          <small>{documentCount === null ? "前往查看" : `${documentCount} 项 · 前往查看`}</small>
        </Link>
        {ASSET_KINDS.map((kind) => {
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
          <span>先选类型，再拖入或选择文件。副本保存到当前设备；大文件建议在桌面端引用原路径。</span>
        </div>
        <label className="asset-library__kind-select">
          <span>资产类型</span>
          <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as ProjectAssetKind)} disabled={busy}>
            {ASSET_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept={assetKind(uploadKind).extensions.map((extension) => `.${extension}`).join(",")}
          multiple
          hidden
          onChange={handleInput}
        />
        <button type="button" className="asset-library__button is-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {busy ? <LoaderCircle className="asset-library__spin" size={16} /> : <FilePlus2 size={16} />}
          {busy ? "正在保存…" : "导入副本"}
        </button>
        {desktop && (
          <button type="button" className="asset-library__button" disabled={busy} onClick={() => void choosePath()}>
            <FolderOpen size={16} /> 引用原文件
          </button>
        )}
      </section>
      <p className="asset-library__format-note">支持：{assetKind(uploadKind).extensions.map((extension) => `.${extension}`).join("、")}。算法 ZIP 只归档，不自动解压或执行。</p>

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
            <h2>已归档资产 <small>{assets.length}</small></h2>
          </div>
          <label className="asset-library__search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资产名称" aria-label="搜索资产名称" />
          </label>
        </div>
        <div className="asset-library__filters" aria-label="资产类型筛选">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部</button>
          {ASSET_KINDS.map((kind) => (
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
                <article className="asset-library__item" key={asset.id}>
                  <span className={`asset-library__file-icon is-${asset.kind}`}><Icon size={21} aria-hidden="true" /></span>
                  <div className="asset-library__item-copy">
                    <strong title={asset.fileName}>{asset.name}</strong>
                    <span>{assetKind(asset.kind).label} · {asset.fileName} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.createdAt)}</span>
                    {asset.source === "path" && <small title={asset.path ?? ""}>路径引用 · {asset.path}</small>}
                  </div>
                  <div className="asset-library__item-actions">
                    {asset.source === "copy" ? (
                      <button type="button" className="asset-library__button" onClick={() => void download(asset)}><Download size={15} /> 下载</button>
                    ) : (
                      <button type="button" className="asset-library__button" onClick={() => void reveal(asset)}><ExternalLink size={15} /> 定位</button>
                    )}
                    <button type="button" className="asset-library__remove" aria-label={`移除${asset.fileName}`} title="移除资产" disabled={busy} onClick={() => void remove(asset)}><Trash2 size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="asset-library__empty">
            <FileArchive size={29} aria-hidden="true" />
            <strong>{assets.length ? "没有匹配的资产" : "项目资产库还是空的"}</strong>
            <p>{assets.length ? "试试其他关键词或分类。" : "选择资产类型并导入文件，开始整理项目资料。"}</p>
          </div>
        )}
      </section>
    </div>
  );
}
