/** 工作台内置 PDF 分页阅读。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfReaderProps {
  file: Blob;
}

export default function PdfReader({ file }: PdfReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | null = null;
    void (async () => {
      try {
        task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const document = await task.promise;
        if (!cancelled) setPdf(document);
      } catch (reason) {
        if (!cancelled) setError(`PDF 解析失败：${String(reason)}`);
      }
    })();
    return () => {
      cancelled = true;
      if (task) void task.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!pdf || !width || !canvasRef.current) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min(1, Math.max(0.1, (width - 32) / base.width));
        const scale = fit * zoom;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        task = page.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (reason) {
        if (!cancelled) setError(`页面绘制失败：${String(reason)}`);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, width, zoom]);

  return (
    <div className="documents__pdf">
      <div className="documents__pdf-toolbar" aria-label="PDF 阅读控制">
        <div className="documents__pdf-group">
          <button type="button" aria-label="上一页" disabled={!pdf || pageNumber <= 1} onClick={() => { setRendering(true); setError(null); setPageNumber((page) => page - 1); }}><ChevronLeft size={16} /></button>
          <span aria-live="polite">{pdf ? `${pageNumber} / ${pdf.numPages}` : "读取中"}</span>
          <button type="button" aria-label="下一页" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => { setRendering(true); setError(null); setPageNumber((page) => page + 1); }}><ChevronRight size={16} /></button>
        </div>
        <div className="documents__pdf-group">
          <button type="button" aria-label="缩小" disabled={zoom <= 0.5} onClick={() => { setRendering(true); setError(null); setZoom((value) => Math.max(0.5, value - 0.25)); }}><Minus size={16} /></button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="放大" disabled={zoom >= 2.5} onClick={() => { setRendering(true); setError(null); setZoom((value) => Math.min(2.5, value + 0.25)); }}><Plus size={16} /></button>
          <button type="button" aria-label="恢复缩放" disabled={zoom === 1} onClick={() => { setRendering(true); setError(null); setZoom(1); }}><RotateCcw size={15} /></button>
        </div>
      </div>
      <div className="documents__pdf-viewport" ref={viewportRef}>
        {error ? <div className="documents__pdf-error" role="alert">{error}</div> : null}
        {!error && rendering ? <span className="documents__pdf-loading" role="status">正在绘制 PDF 页面…</span> : null}
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
      </div>
    </div>
  );
}
