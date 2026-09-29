# 仿真

`pages/` 放 Studio 交互页；`components/` 放仅本页使用的界面组件（关节卡片、PID 滑杆、参数方案卡片、示波波形、手眼面板），从全局 components 归位至此。机器人模型与 Three.js 场景仍由共享目录承载，后续由 Rust 权威运行时提供状态。
