/** 本地视频资源元信息。Created on 2026-09-27 @author: https://github.com/Linmoqian */
export interface VideoResource {
  id: string;
  name: string;
  fileName: string;
  source: "import" | "path";
  mimeType: string | null;
  sizeBytes: number | null;
  durationS: number | null;
  createdAt: string;
  path: string | null;
}
