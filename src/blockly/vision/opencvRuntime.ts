// 隔离 OpenCV 的 CommonJS 自返回 thenable。Created on 2026-09-27
// @author: https://github.com/Linmoqian
import cv from "opencv-ts";

// 通过同步函数读取原库；此 ESM 模块的命名空间不导出 then。
export function getOpenCvRuntime(): unknown {
  return cv;
}
