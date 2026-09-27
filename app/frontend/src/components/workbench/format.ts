// 工作台通用文件尺寸与日期格式。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

export function formatBytes(bytes: number | null, unknownLabel = "原文件路径"): string {
  if (bytes === null) return unknownLabel;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
