# 工作台分层架构

应用入口在 `app/`：`frontend/` 保存 React 界面、Three.js 显示与 Blockly 编辑器；`src-tauri/` 保存 Rust 命令和后台运行时。工程说明在 `docs/`，模拟服务与验证脚本在 `tools/`。各功能目录的 `README.md` 标明本地职责。

桌面端由 Rust 维护唯一仿真循环和权威关节、底盘、TCP 状态。URDF 解析、运动学、碰撞门禁、Rapier 场景物理、回放插值、积木控制流及合成数据训练均在对应后端模块执行；前端接收有序 Channel 状态并渲染。积木动作经请求和回执交给设备网关，桌面仿真的 TCP 目标由 Rust 逆运动学求解。浏览器预览保留前端实现，仅用于界面验收。

串口、SLCAN 原始传输、WebSocket 建链及 AI 进程生命周期由 Rust 管理。WebSocket 协议解析、心跳和重连状态仍由共享的前端连接层处理；Rust 对桌面端控制命令序号做过期拒绝。飞特 SDK 和本地模型推理继续作为受 Rust 管理的 Python 桥，真实设备行为需要设备验收。

实验、资源和业务草稿写入应用数据目录，Rust 使用临时文件与原子提交。桌面端首次读取时将旧 IndexedDB 或 localStorage 数据分批复制，保留原件；失败后再次读取会重试。旧实验导出和 RecordingFile v1 边界保持兼容，录像角度在读入时换成 SI 弧度。

静态检查使用 `pnpm --dir app exec tsc --noEmit`、`pnpm --dir app run lint`、`cargo fmt --manifest-path app/src-tauri/Cargo.toml --check`、`cargo check --manifest-path app/src-tauri/Cargo.toml --locked` 和 `git diff --check`。本项目约束不运行生产构建；浏览器截图只能证明预览页面，桌面 Rust 命令及设备动作应分别验收。
