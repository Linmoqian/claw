# 工作台公共界面

集中放置全局实验操作、上下文与错误恢复界面。业务记录由 `app/frontend/src/features/experiments/domain` 管理，运动生命周期由 `app/frontend/src/features/workbench/runtime` 管理；组件不直接下发硬件指令。

`LoadingState` 统一页面、记录面板与三维场景的加载提示，短操作在原按钮中显示旋转图标。
`format.ts` 集中处理视频、文档和项目资产的文件尺寸与日期显示。
