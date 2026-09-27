/** PDF 与 Markdown 文档收集及阅读。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useLocation } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BookOpen,
  CircleAlert,
  Download,
  FileCode2,
  FilePlus2,
  FileText,
  LoaderCircle,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import LoadingState from "../../../components/workbench/LoadingState";
import { formatBytes, formatDate } from "../../../components/workbench/format";
import PdfReader from "../../../components/documents/PdfReader";
import {
  documentRepository,
  type DocumentKind,
  type DocumentRecord,
} from "../documents/repository";
import "./Documents.css";

type KindFilter = "all" | DocumentKind;
type Preview =
  | { id: string; kind: "markdown"; content: string }
  | { id: string; kind: "pdf"; file: Blob }
  | { id: string; kind: "error"; message: string };

const ACCEPT = ".pdf,.md,.markdown,application/pdf,text/markdown";
const FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "pdf", label: "PDF" },
  { id: "markdown", label: "Markdown" },
];

export default function Documents() {
  const { search: locationSearch } = useLocation();
  const requestedDocumentId = new URLSearchParams(locationSearch).get("document");
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KindFilter>("all");
  const [mobileView, setMobileView] = useState<"list" | "reader">("list");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readerVersion, setReaderVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void documentRepository.list().then(
      (items) => {
        if (cancelled) return;
        setRecords(items);
        setSelectedId((current) =>
          items.find((item) => item.id === requestedDocumentId)?.id ??
          (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null),
        );
        setLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(`文档库读取失败：${String(reason)}`);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestedDocumentId]);

  const selected = records.find((item) => item.id === selectedId) ?? null;
  const selectedKind = selected?.kind;
  useEffect(() => {
    if (!selectedId || !selectedKind) return;
    const id = selectedId;
    let cancelled = false;
    void (async () => {
      try {
        const file = await documentRepository.file(id);
        if (cancelled) return;
        if (selectedKind === "markdown") {
          const content = await file.text();
          if (!cancelled) setPreview({ id, kind: "markdown", content });
        } else {
          if (!cancelled) setPreview({ id, kind: "pdf", file });
        }
      } catch (reason) {
        if (!cancelled) {
          setPreview({ id, kind: "error", message: String(reason) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedKind, readerVersion]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return records.filter(
      (item) =>
        (filter === "all" || item.kind === filter) &&
        (!query || `${item.name} ${item.fileName}`.toLocaleLowerCase().includes(query)),
    );
  }, [filter, records, search]);

  const refresh = async () => {
    try {
      const items = await documentRepository.list();
      setRecords(items);
      setSelectedId((current) =>
        current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null,
      );
      setError(null);
    } catch (reason) {
      setError(`文档库读取失败：${String(reason)}`);
    } finally {
      setLoading(false);
    }
  };

  const importFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const failures: string[] = [];
    let first: DocumentRecord | null = null;
    let saved = 0;
    for (const file of files) {
      try {
        const record = await documentRepository.import(file);
        first ??= record;
        saved++;
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : String(reason));
      }
    }
    await refresh();
    if (first) {
      setSelectedId(first.id);
      setMobileView("reader");
      setNotice(`已保存 ${saved} 份文档到当前设备。`);
    }
    if (failures.length) setError(`导入未完成：${failures.join("；")}`);
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

  const download = async (record: DocumentRecord) => {
    try {
      const file = await documentRepository.file(record.id);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = record.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) {
      setError(`下载失败：${String(reason)}`);
    }
  };

  const remove = async (record: DocumentRecord) => {
    if (!window.confirm(`移除「${record.name}」？这会删除工作台保存的文档副本。`)) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await documentRepository.remove(record.id);
      await refresh();
      setNotice(`已移除「${record.name}」。`);
    } catch (reason) {
      setError(`移除失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage documents">
      <header className="documents__header">
        <div>
          <span className="section-label">数据与智能</span>
          <h1>文档收集</h1>
          <p>整理实验手册、论文和说明文档。文件副本保存在当前设备，随时阅读与下载。</p>
        </div>
        <BookOpen className="documents__header-icon" aria-hidden="true" />
      </header>

      <div
        className={`documents__dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <UploadCloud size={23} aria-hidden="true" />
        <div>
          <strong>把 PDF 或 Markdown 放进工作台</strong>
          <span>拖入文件，或选择多个文件批量导入；保存后刷新仍可阅读。</span>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={handleInput} />
        <button
          type="button"
          className="documents__button is-primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <LoaderCircle className="documents__spin" size={16} /> : <FilePlus2 size={16} />}
          {busy ? "正在保存…" : "导入文档"}
        </button>
      </div>

      {notice && <p className="documents__notice" role="status">{notice}</p>}
      {error && (
        <div className="documents__error" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>重试读取</button>
        </div>
      )}

      <div className="documents__layout" data-view={mobileView}>
        <section className="documents__library" aria-label="文档列表">
          <div className="documents__panel-head">
            <div>
              <span className="documents__eyebrow">LIBRARY</span>
              <h2>全部文档 <small>{records.length}</small></h2>
            </div>
          </div>
          <label className="documents__search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索文档名称"
              aria-label="搜索文档名称"
            />
          </label>
          <div className="documents__filters" aria-label="文档类型筛选">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {loading ? (
            <LoadingState label="正在读取文档" detail="从当前设备的文档库加载" variant="panel" />
          ) : visible.length ? (
            <div className="documents__list">
              {visible.map((item) => {
                const Icon = item.kind === "pdf" ? FileText : FileCode2;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`documents__item${item.id === selectedId ? " is-active" : ""}`}
                    aria-current={item.id === selectedId ? "true" : undefined}
                    onClick={() => { setSelectedId(item.id); setMobileView("reader"); }}
                  >
                    <span className={`documents__file-icon is-${item.kind}`}><Icon size={20} /></span>
                    <span className="documents__item-copy">
                      <strong title={item.fileName}>{item.name}</strong>
                      <small>{item.kind === "pdf" ? "PDF" : "MD"} · {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="documents__empty">
              <FileText size={26} aria-hidden="true" />
              <strong>{records.length ? "没有匹配的文档" : "文档库还是空的"}</strong>
              <p>{records.length ? "试试其他关键词或类型。" : "导入一份 PDF 或 Markdown 开始整理。"}</p>
            </div>
          )}
        </section>

        <section className="documents__reader" aria-label="文档阅读器">
          {selected ? (
            <>
              <div className="documents__reader-head">
                <button
                  type="button"
                  className="documents__back"
                  onClick={() => setMobileView("list")}
                >
                  <ArrowLeft size={16} /> 返回列表
                </button>
                <div className="documents__reader-title">
                  <span className="documents__eyebrow">{selected.kind === "pdf" ? "PDF READER" : "MARKDOWN READER"}</span>
                  <h2 title={selected.fileName}>{selected.name}</h2>
                  <span>{selected.fileName} · {formatBytes(selected.sizeBytes)}</span>
                </div>
                <div className="documents__reader-actions">
                  <button type="button" className="documents__button" onClick={() => void download(selected)}>
                    <Download size={15} /> 下载原件
                  </button>
                  <button
                    type="button"
                    className="documents__icon-button"
                    title="移除文档"
                    aria-label={`移除${selected.name}`}
                    disabled={busy}
                    onClick={() => void remove(selected)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {preview?.id !== selected.id ? (
                <LoadingState label="正在打开文档" detail="从当前设备读取文件副本" variant="panel" />
              ) : preview.kind === "error" ? (
                <div className="documents__reader-error" role="alert">
                  <CircleAlert size={22} />
                  <strong>文档无法打开</strong>
                  <p>{preview.message}</p>
                  <button type="button" className="documents__button" onClick={() => setReaderVersion((value) => value + 1)}>重试</button>
                </div>
              ) : preview.kind === "pdf" ? (
                <PdfReader key={selected.id} file={preview.file} />
              ) : (
                <article className="documents__markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                    {preview.content}
                  </ReactMarkdown>
                </article>
              )}
            </>
          ) : (
            <div className="documents__reader-empty">
              <BookOpen size={32} aria-hidden="true" />
              <strong>选择一份文档开始阅读</strong>
              <p>Markdown 会按工作台排版呈现，PDF 可在这里翻页和缩放。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
