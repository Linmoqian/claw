# 资产

`pages/` 放资产与文档界面；`documents/`、`videos/`、`project-assets/` 分别负责对应资源。

桌面端的仓库统一经 `desktopStorage.ts` 调用 Rust 命令。文档、训练数据、模型元信息由 Rust 管理的 SQLite 三张表保存，大文件仍留在原文件清单中。各旧 IndexedDB 仓库改名为 `indexedDbRepository.ts` 并保留原格式，用于首次迁移和浏览器预览；迁移失败不会删除原文件。
