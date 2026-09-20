# 虾烤工作台

面向不同机械臂的浅色桌面仿真与调参工作台。当前内置 SO-100 配置，
通过机器人模型与通信适配器逐步扩展到其他机械臂。

## 功能

- **仿真与调参**：3D 数字孪生、关节控制和 PID 响应模型处于同一工作区
- **机器人连接**：扫描串口、识别控制器并展示数据源状态
- **关节观测**：位置、目标、电流、温度与误差读数
- **参数草案**：实时观察 SP/PV 阶跃响应，按关节独立保存调参方案
- **智能训练**：基于仿真特征训练感知 Softmax 分类器与决策 MLP 网络，并导出模型/样本

## 技术栈

Tauri 2 · React 19 · TypeScript · Vite · motion · lucide-react

## 开发

```bash
pnpm install
pnpm run dev        # 浏览器预览（固定端口 1421）
pnpm run tauri dev  # Tauri 桌面应用
pnpm exec tsx scripts/verify-model-training.ts  # 验证感知/决策训练基线
```

> 浏览器预览时 Tauri 窗口 API 自动降级（`isTauri` 守卫），不影响布局验证。

## 本地视觉助手

桌面端的“视觉助手”页面支持本机 ZDTaichu5.0-9B 和 OpenAI-compatible 供应商，
支持文本聊天和本地图片问答。模型采用现有 4bit + GPU/CPU offload 配置，不会调用机械臂控制命令。

默认配置为：

- Python：`C:\Users\30470\Anaconda3\envs\zdtaichu\python.exe`
- 模型：`D:\models\ZDTaichu5.0-9B`

如需覆盖路径，在启动桌面端前设置环境变量：

```powershell
$env:ZDTAICHU_PYTHON = "C:\Users\30470\Anaconda3\envs\zdtaichu\python.exe"
$env:ZDTAICHU_MODEL_PATH = "D:\models\ZDTaichu5.0-9B"
pnpm run tauri dev
```

OpenAI-compatible 示例：

```env
AI_PROVIDER=openai-compatible
AI_MODEL=qwen2.5-vl
AI_BASE_URL=http://127.0.0.1:1234/v1
AI_API_KEY=
AI_SUPPORTS_VISION=true
AI_MAX_TOKENS=128
```

进入“视觉助手”后点击“启动模型”，再选择图片并发送问题。首次加载本地模型较慢属于正常现象。

## 快捷键

- `←` / `→`：切换选中关节
