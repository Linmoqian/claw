# 视频资源

`repository.ts` 在桌面端调用 Rust 分块资源仓库，在浏览器预览中沿用 `indexedDbRepository.ts`。文件副本和本机路径引用分别保存；首次桌面读取迁移旧视频并保留原 IndexedDB 备份。

`file.ts` 提供格式识别与时长读取。浏览器无法直接读取任意本地路径；大视频建议引用原文件以避免复制，副本播放仍需将文件读取为 Blob。
