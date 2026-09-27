# 积木视觉

仿真网关使用合成图像，颜色识别由 OpenCV.js 执行，PnP 使用已识别目标估算相机坐标。

`opencvRuntime.ts` 用同步导入隔离原库的 CommonJS `then`，`vision.ts` 延迟加载该模块并返回装箱对象。不要直接动态导入 `opencv-ts` 或从 Promise 返回原始 `cv`：Vite 兼容转换和 Emscripten 自返回 thenable 都可能造成无限微任务循环。

运行 `pnpm dlx tsx tools/verification/verify-block-vision.ts` 验证初始化与颜色识别。验证通过外部子进程限制时长，避免回归导致测试本身挂起。
