# 工作台运行时

`RuntimeHost` 在应用中挂载一次，持有画布和相机。页面只提供 `data-runtime-slot` 场景占位；切换页面不会重新创建场景。桌面端由 `desktopRuntime.ts` 向 Rust 提交控制意图并消费状态帧，浏览器预览保留前端仿真。

`runtime.ts` 提供实例读取、停止和就绪等待；`programRunner.ts` 使用独立 Blockly Workspace 冻结快照。桌面程序由 Rust 执行树解释器调度，浏览器预览使用原解释器。`activity.ts` 保存实验与设备互斥状态。`draftStorage.ts` 首次桌面读取时将原始 localStorage 草稿复制到 Rust，旧值保持不变供重试。实验记录和 AI 密钥不进入运行时草稿。
