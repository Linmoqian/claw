/** 本地视频资源的导入、引用与预览。Created on 2026-09-27; Updated on 2026-09-30 @author: https://github.com/Linmoqian */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocation } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CircleAlert,
  Clapperboard,
  ExternalLink,
  FilePlus2,
  Film,
  FolderOpen,
  LoaderCircle,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import LoadingState from "../../../components/workbench/LoadingState";
import { formatBytes } from "../../../components/workbench/format";
import { isDesktop } from "../../../lib/serial";
import { videoRepository } from "../videos/repository";
import { isVideoName, readVideoDuration, VIDEO_ACCEPT, VIDEO_EXTENSIONS } from "../videos/file";
import type { VideoResource } from "../videos/types";
import "./VideoLibrary.css";

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "时长待识别";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export default function VideoLibrary() {
  const { search: locationSearch } = useLocation();
  const requestedVideoId = new URLSearchParams(locationSearch).get("video");
  const [videos, setVideos] = useState<VideoResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showPathForm, setShowPathForm] = useState(false);
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<VideoResource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const desktop = isDesktop();

  const refresh = async () => {
    try {
      setVideos(await videoRepository.list());
      setError(null);
    } catch (reason) {
      setError(`视频资源读取失败：${String(reason)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void videoRepository.list().then(
      (records) => {
        if (!cancelled) {
          setVideos(records);
          if (requestedVideoId) setSelected(records.find((item) => item.id === requestedVideoId) ?? null);
          setError(null);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(`视频资源读取失败：${String(reason)}`);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestedVideoId]);

  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    if (selected.source !== "import") return () => dialog?.close();
    let cancelled = false;
    let url: string | null = null;
    void videoRepository.file(selected.id).then(
      (file) => {
        if (cancelled) return;
        url = URL.createObjectURL(file);
        setPreviewUrl(url);
      },
      (reason: unknown) => {
        if (!cancelled) setPreviewError(String(reason));
      },
    );
    return () => {
      cancelled = true;
      dialog?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected]);

  const visibleVideos = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? videos.filter((video) =>
          `${video.name} ${video.fileName}`.toLocaleLowerCase().includes(query),
        )
      : videos;
  }, [search, videos]);

  const showVideo = (video: VideoResource) => {
    setPreviewUrl(null);
    setPreviewError(null);
    setSelected(video);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    let saved = 0;
    try {
      for (const file of files) {
        if (!isVideoName(file.name, file.type))
          throw new Error(`${file.name} 不是受支持的视频文件`);
        if (file.size === 0) throw new Error(`${file.name} 是空文件`);
        await videoRepository.import(file, await readVideoDuration(file));
        saved += 1;
        await refresh();
      }
      setNotice(`已保存 ${saved} 个视频，可在当前设备预览。`);
    } catch (reason) {
      setError(
        `已保存 ${saved} 个；后续导入失败：${String(reason)}。大文件可改用“引用本地路径”。`,
      );
    } finally {
      setBusy(false);
    }
  };

  const choosePath = async () => {
    if (!desktop) return;
    try {
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "视频文件", extensions: VIDEO_EXTENSIONS }],
      });
      if (typeof chosen === "string") setPath(chosen);
    } catch (reason) {
      setError(`选择文件失败：${String(reason)}`);
    }
  };

  const savePath = async () => {
    const value = path.trim().replace(/^"|"$/g, "");
    if (!value || !isVideoName(value) || !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value)) {
      setError("请输入视频文件的完整路径，支持 MP4、WebM、MOV、M4V、MKV、AVI 和 OGV。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await videoRepository.link(value);
      await refresh();
      setPath("");
      setShowPathForm(false);
      setNotice("已添加路径引用。原视频留在原位置。");
    } catch (reason) {
      setError(`路径引用未保存：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const revealReferencedVideo = async (video: VideoResource) => {
    if (!desktop || !video.path) return;
    try {
      await revealItemInDir(video.path);
      setPreviewError(null);
    } catch (reason) {
      setPreviewError(`无法定位原文件：${String(reason)}。请确认路径仍然有效。`);
    }
  };

  const remove = async (video: VideoResource) => {
    const detail =
      video.source === "import"
        ? "这会移除工作台保存的视频副本。"
        : "这只会移除工作台中的路径引用，不会删除原视频。";
    if (!window.confirm(`移除「${video.name}」？${detail}`)) return;
    setBusy(true);
    setError(null);
    try {
      await videoRepository.remove(video.id);
      if (selected?.id === video.id) setSelected(null);
      await refresh();
      setNotice(`已移除「${video.name}」。`);
    } catch (reason) {
      setError(`移除失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="video-library" aria-label="视频资源库">
      <div className="video-library__head">
        <div>
          <span className="data-collection__card-kicker">VIDEO LIBRARY</span>
          <h2>视频资源</h2>
          <p>集中查看实验录像与演示视频。导入保存副本，路径引用保留原文件位置。</p>
        </div>
        <span className="video-library__count">{videos.length} 个视频</span>
      </div>
      <div className="video-library__toolbar">
        <label className="video-library__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索视频名称"
            aria-label="搜索视频名称"
          />
        </label>
        <div className="video-library__actions">
          <input
            ref={inputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            multiple
            hidden
            onChange={(event) => void handleImport(event)}
          />
          <button
            type="button"
            className="experiments__button is-primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <LoaderCircle className="video-library__spin" size={15} /> : <FilePlus2 size={15} />}
            {busy ? "正在处理…" : "导入视频"}
          </button>
          <button
            type="button"
            className="experiments__button"
            disabled={busy}
            onClick={() => setShowPathForm((current) => !current)}
          >
            <FolderOpen size={15} /> 引用本地路径
          </button>
        </div>
      </div>
      {showPathForm && (
        <div className="video-library__path-form">
          <label htmlFor="video-resource-path">视频文件完整路径</label>
          <div>
            <input
              id="video-resource-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="例如 D:\\实验录像\\步态测试.mp4"
              onKeyDown={(event) => {
                if (event.key === "Enter") void savePath();
              }}
            />
            {desktop && (
              <button type="button" className="experiments__button" onClick={() => void choosePath()}>
                浏览文件
              </button>
            )}
            <button type="button" className="experiments__button is-primary" disabled={busy} onClick={() => void savePath()}>
              保存引用
            </button>
          </div>
          <p>路径引用不会复制文件；桌面端可在文件夹中定位原视频。浏览器预览请使用“导入视频”。</p>
        </div>
      )}
      {notice && <p className="video-library__notice" role="status">{notice}</p>}
      {error && (
        <div className="video-library__error" role="alert">
          <CircleAlert size={16} /> <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>重试读取</button>
        </div>
      )}
      {loading ? (
        <LoadingState label="正在读取视频资源" detail="从当前设备的资源库加载" variant="panel" />
      ) : visibleVideos.length === 0 ? (
        <div className="video-library__empty">
          <Clapperboard size={30} aria-hidden="true" />
          <strong>{search ? "没有匹配的视频" : "从第一段视频开始"}</strong>
          <p>{search ? "换一个名称试试。" : "导入 MP4、WebM 等视频，或引用本地文件路径。"}</p>
        </div>
      ) : (
        <div className="video-library__grid">
          {visibleVideos.map((video) => (
            <article className="video-library__card" key={video.id}>
              <div className="video-library__poster">
                <Film size={35} aria-hidden="true" />
                <span>{video.source === "import" ? "本地副本" : "路径引用"}</span>
              </div>
              <div className="video-library__card-body">
                <h3 title={video.fileName}>{video.name}</h3>
                <div className="video-library__meta">
                  <span>{formatDuration(video.durationS)}</span>
                  <span>{formatBytes(video.sizeBytes, "文件保留在原位置")}</span>
                  <span>{new Date(video.createdAt).toLocaleDateString("zh-CN")}</span>
                </div>
                <div className="video-library__card-actions">
                  <button type="button" className="experiments__button is-primary" onClick={() => showVideo(video)}>
                    <Play size={14} /> {video.source === "import" ? "预览" : "查看路径"}
                  </button>
                  <button
                    type="button"
                    className="video-library__remove"
                    aria-label={`移除${video.name}`}
                    title="移除资源"
                    disabled={busy}
                    onClick={() => void remove(video)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <dialog ref={dialogRef} className="video-library__dialog" onClose={() => setSelected(null)}>
          <div className="video-library__dialog-head">
            <div>
              <span className="data-collection__card-kicker">视频资源</span>
              <h2>{selected.name}</h2>
            </div>
            <button type="button" aria-label="关闭视频预览" onClick={() => setSelected(null)}><X size={18} /></button>
          </div>
          {selected.source === "import" ? (
            <>
              {previewUrl ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={previewUrl}
                  onError={() => setPreviewError("当前播放器无法解码此视频；请用原格式重新编码后预览。")}
                />
              ) : !previewError ? (
                <LoadingState label="正在载入视频" variant="panel" />
              ) : null}
            </>
          ) : (
            <div className="video-library__reference">
              <p>原文件路径</p>
              <code>{selected.path}</code>
              {desktop ? (
                <button type="button" className="experiments__button is-primary" onClick={() => void revealReferencedVideo(selected)}>
                  <ExternalLink size={15} /> 在文件夹中显示
                </button>
              ) : (
                <p>浏览器无法直接打开本机路径。请在桌面工作台使用此引用，或将视频导入以便预览。</p>
              )}
            </div>
          )}
          {previewError && <p className="video-library__error" role="alert">{previewError}</p>}
          <div className="video-library__dialog-foot">
            <span>{selected.fileName} · {formatBytes(selected.sizeBytes, "文件保留在原位置")}</span>
            <button type="button" className="experiments__button" onClick={() => setSelected(null)}>关闭</button>
          </div>
        </dialog>
      )}
    </section>
  );
}
