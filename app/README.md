# 应用代码

本目录采用 Tauri 的标准项目层级：`package.json`、`index.html`、`src/` 和 `public/` 位于应用根目录，`src-tauri/` 是桌面端 Rust 后端和受控 Python 桥。`src/` 按功能组织 React 界面、交互和三维画布；`public/` 保存品牌与机器人静态资源。进入本目录运行 `pnpm install`、`pnpm run dev` 或 `pnpm run tauri dev`。仓库根目录的 `.env` 供本机开发使用，不进入版本库。
