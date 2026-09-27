# 资产

`pages/` 放资产与文档界面；`documents/`、`videos/`、`project-assets/` 分别负责对应资源。

桌面端的仓库统一经 `desktopStorage.ts` 分块读写 Rust 应用数据目录。各旧 IndexedDB 仓库改名为 `indexedDbRepository.ts` 并保留原格式，用于首次迁移和浏览器预览；迁移失败不会删除原文件。
