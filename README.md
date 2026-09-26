# 虾烤工作台

面向实验室成员的本地实验工作台，将仿真、积木编程、实验记录、数据资源、
训练和设备诊断组织在同一界面中。首页展示当前实验、最近记录和准备状态，
仿真场景及实验采集在应用内切页时持续运行。

## 功能

- **实验闭环**：显式开始采集，以 20 Hz 记录仿真实际运动，结束后本地保存、查看曲线与日志、导出和三维回放
- **仿真与积木**：共享常驻 3D 场景；积木运行冻结程序快照，编辑草稿或切页不会改变本次仿真执行
- **机器人连接**：串口与 WebSocket 分别展示连接状态、失败原因和下一步操作
- **关节观测**：位置、目标、电流、温度与误差读数
- **参数草案**：实时观察 SP/PV 阶跃响应，按关节独立保存调参方案
- **智能训练**：使用内置合成样本训练感知 Softmax 分类器与决策 MLP 网络，并导出模型/样本；参数和结果在应用内切页时保留
- **视觉助手**：桌面端支持本地模型与 OpenAI-compatible 供应商，会话和草稿跨页保留

## 完成一次实验

1. 从工作台首页进入“仿真与调参”或“积木编程”，等待机型就绪，使用仿真通道。
2. 点击顶部“开始实验”并命名。开始实验只建立记录和采样，随后通过关节、轨迹或程序运行按钮操作机器人。
3. 切到“数据资源”可查看采样进度；顶部实验栏提供“返回实验”和“结束实验”。程序自然结束后仍会采集。
4. 点击“结束实验”，等待最终保存完成，再到“实验记录”查看曲线、日志、改名、导出或三维回放。

实验期间固定机型与数据通道；回放前需要结束实验、停止运动并显式断开真机链路。
回放退出后回到仿真待机。保存失败时保留当前会话中的数据，先重试保存或导出，再关闭窗口。

完整流程、存储格式与验证方法见[统一实验工作台说明](docs/development/unified-workbench.md)。

## 技术栈

Tauri 2 · React 19 · TypeScript · Vite · motion · lucide-react

## 开发

```bash
pnpm install
pnpm run dev        # 浏览器预览（固定端口 1421）
pnpm run tauri dev  # Tauri 桌面应用
pnpm dlx tsx scripts/verify-model-training.ts  # 验证感知/决策训练基线
```

> 浏览器预览时 Tauri 窗口 API 自动降级（`isTauri` 守卫），不影响布局验证。

本轮开发验证采用静态检查，不生成生产构建：

```powershell
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
```

实验、积木快照、视觉与页面会话的针对性验证命令见[验收说明](docs/development/unified-workbench.md#验证方式)，实际检查结果见[本轮验证记录](docs/development/unified-workbench.md#本轮验证记录)。

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
