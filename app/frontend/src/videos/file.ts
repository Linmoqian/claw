/** 视频文件识别与时长读取。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv"];
export const VIDEO_ACCEPT = `video/*,${VIDEO_EXTENSIONS.map((part) => `.${part}`).join(",")}`;

export function isVideoName(name: string, mimeType = ""): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return mimeType.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension ?? "");
}

export async function readVideoDuration(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number | null>((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const timeout = window.setTimeout(() => finish(null), 4000);
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
        resolve(value);
      };
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        finish(Number.isFinite(video.duration) ? video.duration : null);
      video.onerror = () => finish(null);
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
