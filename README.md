# claw — 机械臂调参上位机

7 自由度机械臂的 PID 调参上位机，苹果深色极简风格，2.5D 卡片层叠。

## 功能

- **连接区**：USB 串口状态、设备 ID 卡片（2.5D 错落、毛玻璃）
- **7 电机关节卡片**：弧面 2.5D 排列，角度/目标/电流/温度/误差读数，点击选中
- **PID 实时仿真波形**：Canvas 绘制 SP/PV 阶跃响应，调 P/I/D 实时影响曲线
- **运行/暂停/重置**仿真，每电机独立保存 PID 参数

## 技术栈

Tauri 2 · React 19 · TypeScript · Vite · motion · lucide-react

## 开发

```bash
npm install
npm run dev        # 浏览器预览（端口 1420）
npm run tauri dev  # Tauri 桌面应用
```

> 浏览器预览时 Tauri 窗口 API 自动降级（`isTauri` 守卫），不影响布局验证。

## 快捷键

- `←` / `→`：切换选中关节
