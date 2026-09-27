# 工作台运行时

`RuntimeHost` 在应用中挂载一次，持有仿真、物理场景和相机。页面只提供 `data-runtime-slot` 场景占位；切换页面不会重新创建仿真实例。

`runtime.ts` 提供实例读取、停止和就绪等待；`programRunner.ts` 使用独立 Blockly Workspace 执行冻结快照；`activity.ts` 保存实验与设备互斥状态。实验记录和 AI 密钥不进入运行时持久化。
