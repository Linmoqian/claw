/**
 * OpenCV.js 颜色目标识别；所有 Mat 均在使用后释放，摄像头失败时退回合成帧。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import type { Detection } from "../types";

type CvModule = {
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

let cvPromise: Promise<CvLike> | null = null;

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 480;

export async function loadOpenCv(): Promise<CvLike> {
  cvPromise ??= import("opencv-ts").then((module) => {
    const source = module as unknown as { default?: CvLike } & CvLike;
    const candidate = source.default;
    const cv = candidate ?? source;
    if (!cv || typeof cv.matFromImageData !== "function") {
      throw new Error("OpenCV 初始化失败");
    }
    return cv;
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
  const cv = await loadOpenCv();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const source = cv.matFromImageData(imageData);
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const blurred = new cv.Mat();
  const mask = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(source, rgb, 3);
    cv.cvtColor(rgb, hsv, 41);
    cv.GaussianBlur(hsv, blurred, new cv.Size(5, 5), 0);

    let best: Detection | null = null;
    for (const range of ranges) {
      cv.inRange(
        blurred,
        new cv.Scalar(...range.lower),
        new cv.Scalar(...range.upper),
        mask,
      );
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
