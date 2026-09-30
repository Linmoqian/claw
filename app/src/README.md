# 前端源码分层

入口 `main.tsx` 挂载 `App.tsx`：路由（13 页）、Provider、全局外壳（TitleBar / Sidebar / EstopButton / ContextMenu）与常驻 `RuntimeHost`。依赖自上而下单向：

```
入口 App.tsx
  └─ 界面层 components/      跨页共享 UI，不持有业务状态
      └─ 功能层 features/    按域组织页面、私有组件与领域逻辑
          └─ 状态层 stores/  Zustand 全局状态 + DeviceContext 设备上下文
              └─ 基础层     services/ core/ robot/ three/ interaction/ lib/ cad/ command/
```

## 目录职责

- `components/`：全局外壳组件（TitleBar / Sidebar / EstopButton / ContextMenu）及 `components/workbench|documents/` 区域组件；单功能域私有组件一律放在对应 `features/*/components/`。
- `features/`：`workbench`（首页与 `runtime/` 全局运行时）、`simulation`（仿真调参）、`blocks`（积木）、`devices`（电机/蓝牙调试）、`experiments`（实验与采集）、`assets`（视频/文档/项目资产）、`training`、`vision`。每个子目录有本地 README。
- `stores/`：Zustand 跨页状态（session、robot、bridge、simulation、activity 互斥等）与 `DeviceContext.tsx`（串口连接、舵机控制、急停的 React Context）。
- `services/`：v2 协议消息、WebSocket 传输适配、连接管理、仿真/回放/机器人桥；`desktopRuntime.ts` 保存 Rust 仿真状态帧流与订阅，供渲染层与实验域读取；`indexedDb.ts` 是 IndexedDB 连接单例与事务模板，供各资产/实验仓库复用。
- `core/`：纯领域核心（坐标系树、运行时状态、world 位姿与新鲜度、`motors.ts` 电机/调参领域模型），零 UI 依赖。
- `robot/`：浏览器预览用机器人算法（URDF、运动学、IK、碰撞、轨迹、手眼）。
- `three/`：Three.js 渲染组件；`interaction/`：3D 拾取、关节拖拽、TCP gizmo。
- `lib/`：串口与 AI 客户端、调试总线、SO-100 单位换算等工具；`cad/`：DXF 解析与台面工作区状态；`command/`：控制权唯一性仲裁。
- 桌面端状态以 Rust 发布的 Channel 帧为准，见 `docs/development/backend-boundary.md`。

## 依赖规则

1. 基础层禁止 import `stores/`、`components/`、`features/`（`three/` 渲染组件除外：它消费 stores 全局状态与 `services/desktopRuntime` 帧流）。基础层之间的横向依赖应保持最小，现有：`robot/` → `cad/workspaceStore`，`services/bridge|desktopRuntime` → `robot/`（后者仅类型）。
2. `features/` 之间仅允许依赖 `features/workbench/runtime/`（全局共享运行时与实验互斥状态），以及页面级组合其他域的资产组件（当前仅 `DataCollection` → `features/assets/components/VideoLibrary`）。
3. `runtime/` 作为组合根允许依赖各功能域（执行积木程序、电机调试会话）。

## 已知豁免（现状记录，暂不解耦）

- `components/workbench/ExperimentBar` → `features/experiments`、`features/devices`、`features/workbench/runtime`：全局实验栏承载开始/结束实验流程与调试串口占用提示，属外壳业务耦合，解除需状态下沉或回调反转，暂保留。
- `features/workbench` ↔ `features/blocks` 双向已由规则 2/3 覆盖：`BlockLab` → runtime 是允许的功能间依赖，`programRunner` → blocks 是组合根职责，不再单列豁免。

历史豁免已通过归位与注入消除：`stores/*` → activity（移入 `stores/`）、`three/*` → desktopRuntime（下沉 `services/desktopRuntime.ts`）、`stores/trainingSessionStore` → desktopTraining（下沉 `services/desktopTraining.ts`）、`components/RuntimeBoundary` → programRunner（改为入口注入 onError）、`components/videos/VideoLibrary` → assets（移入 `features/assets/components/`）。
