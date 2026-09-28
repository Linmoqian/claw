# 文档收集

`repository.ts` 在桌面端调用 Rust 分块资源仓库，在浏览器预览中使用 `indexedDbRepository.ts`。首次桌面读取会逐份迁入旧 PDF 和 Markdown 副本，完成标记写入 Rust 应用数据目录；失败保留原数据并重试。

列表仅读取元信息，阅读时才加载文件。页面位于 `app/src/features/assets/pages/Documents.tsx`，项目资产页通过文档 ID 打开对应阅读内容。
