/**
 * OpenCV.js 颜色目标识别；所有 Mat 均在使用后释放，摄像头失败时退回合成帧。
 *
 * Created on 2026-09-27
 * @author:  https://github.com/Linmoqian
 */
import type { Detection } from "../types";

type CvModule = {
  COLOR_RGBA2RGB: number;
  COLOR_RGB2HSV: number;
  CV_8UC3: number;
  matFromImageData: (data: ImageData) => unknown;
  Mat: new (...args: unknown[]) => unknown;
  MatVector: new () => {
    size(): number;
    get(index: number): unknown;
    delete(): void;
  };
  cvtColor: (src: unknown, dst: unknown, code: number, dstCn?: number) => void;
  GaussianBlur: (
    src: unknown,
    dst: unknown,
    size: unknown,
    sigmaX: number,
  ) => void;
  inRange: (src: unknown, lower: unknown, upper: unknown, dst: unknown) => void;
  findContours: (
    src: unknown,
    contours: unknown,
    hierarchy: unknown,
    mode: number,
    method: number,
  ) => void;
  contourArea: (contour: unknown, oriented?: boolean) => number;
  boundingRect: (contour: unknown) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  Scalar: new (...values: number[]) => unknown;
  Size: new (width: number, height: number) => unknown;
};

type CvLike = CvModule & Record<string, unknown>;
type CvReady = { cv: CvLike };

let cvPromise: Promise<CvReady> | null = null;

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 480;

export async function loadOpenCv(): Promise<CvReady> {
  // 直接动态导入 CommonJS 库会让 Vite 把 cv.then 展开到 Promise 返回值上。
  cvPromise ??= import("./opencvRuntime").then((module) => {
    const cv = module.getOpenCvRuntime() as CvLike;
    return new Promise<CvReady>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenCV 初始化超时，请重试")), 15000);
      const ready = () => {
        clearTimeout(timeout);
        if (!cv || typeof cv.matFromImageData !== "function" || typeof cv.Mat !== "function") {
          reject(new Error("OpenCV 初始化失败"));
          return;
        }
        // Emscripten 的 cv.then 会再次返回 cv；必须装箱，避免 Promise 无限同化同一个 thenable。
        resolve({ cv });
      };
      try {
        if (typeof cv?.then === "function") {
          (cv.then as (callback: () => void) => void)(ready);
        } else {
          ready();
        }
      } catch (error: unknown) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }).catch((error: unknown) => {
    cvPromise = null;
    throw error;
  });
  return cvPromise;
}

export function createSyntheticCameraCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 2D 图像上下文");
  context.fillStyle = "#e7e9ee";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#d81f2a";
  context.fillRect(210, 170, 130, 130);
  context.fillStyle = "#2258c8";
  context.fillRect(430, 290, 90, 90);
  context.fillStyle = "#e2c020";
  context.fillRect(70, 320, 80, 80);
  return canvas;
}

export async function captureToCanvas(
  source: ImageBitmapSource | null,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建 2D 图像上下文");

  if (source instanceof HTMLVideoElement && source.readyState >= 2) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  if (source instanceof HTMLCanvasElement) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  if (source instanceof ImageBitmap) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  if (
    typeof HTMLImageElement !== "undefined" &&
    source instanceof HTMLImageElement &&
    source.complete
  ) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  return createSyntheticCameraCanvas();
}

const COLOR_RANGES: Record<
  string,
  Array<{ lower: [number, number, number]; upper: [number, number, number] }>
> = {
  RED: [
    { lower: [0, 75, 60], upper: [8, 255, 255] },
    { lower: [168, 75, 60], upper: [180, 255, 255] },
  ],
  BLUE: [{ lower: [92, 70, 55], upper: [130, 255, 255] }],
  YELLOW: [{ lower: [22, 70, 60], upper: [42, 255, 255] }],
  GREEN: [{ lower: [42, 60, 50], upper: [85, 255, 255] }],
};

export async function detectColorFromCanvas(
  canvas: HTMLCanvasElement,
  label: keyof typeof COLOR_RANGES | string,
  minAreaPx = 500,
): Promise<Detection | null> {
  const ranges = COLOR_RANGES[label.toUpperCase()];
  if (!ranges) throw new Error(`不支持的目标颜色：${label}`);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("摄像头帧不可读");
  const { cv } = await loadOpenCv();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const source = cv.matFromImageData(imageData);
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const blurred = new cv.Mat();
  const mask = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.GaussianBlur(hsv, blurred, new cv.Size(5, 5), 0);

    let best: Detection | null = null;
    for (const range of ranges) {
      const lower = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC3, new cv.Scalar(...range.lower));
      const upper = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC3, new cv.Scalar(...range.upper));
      try {
        // OpenCV.js 的 inRange 绑定需要矩阵上下界，不接受 Scalar 直接作输入。
        cv.inRange(blurred, lower, upper, mask);
      } finally {
        (lower as { delete: () => void }).delete();
        (upper as { delete: () => void }).delete();
      }
      cv.findContours(mask, contours, hierarchy, 0, 2);
      for (let index = 0; index < contours.size(); index += 1) {
        const contour = contours.get(index);
        try {
          const area = cv.contourArea(contour, false);
          if (area < minAreaPx) continue;
          const rect = cv.boundingRect(contour);
          const candidate: Detection = {
            label: String(label).toUpperCase(),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            centerX: rect.x + rect.width / 2,
            centerY: rect.y + rect.height / 2,
            area,
            confidence: Math.min(1, area / (rect.width * rect.height || 1)),
          };
          if (!best || candidate.area > best.area) best = candidate;
        } finally {
          if (
            contour &&
            typeof (contour as { delete?: () => void }).delete === "function"
          ) {
            (contour as { delete: () => void }).delete();
          }
        }
      }
    }
    return best;
  } finally {
    [source, rgb, hsv, blurred, mask, hierarchy].forEach((item) => {
      if (
        item &&
        typeof (item as { delete?: () => void }).delete === "function"
      ) {
        (item as { delete: () => void }).delete();
      }
    });
    contours.delete();
  }
}
