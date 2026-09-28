# 积木编程设备运行时 v1

积木控制台默认使用仿真通道。桌面端必须显式切换“硬件通道”，并满足串口已连接、
非急停后，才允许硬件网关访问真实舵机或 MCU。

## Feetech 扩展

- 舵机角度块输入为度；下发前按 `app/src/lib/units.ts` 的 SO-100 校准表转 raw。
- 电机速度块输入为 `°/s`，范围 `5..300`；按 STS3215 分辨率转
  `MOVING_SPEED`（寄存器 46，raw 上限 2400）。
- 扭矩使能是硬件动作前置条件；急停会中止解释器并保持硬件急停策略。

## MCU JSON 行协议 v1

通用 MCU 串口桥与 Feetech 舵机会话独立。每条请求和响应都是一行 UTF-8 JSON。

请求：

```json
{"op":"pin_mode","pin":2,"mode":"input_pullup"}
{"op":"digital_write","pin":2,"value":1}
{"op":"digital_read","pin":2}
{"op":"analog_write","pin":9,"value":128}
{"op":"analog_read","pin":0}
```

成功响应：

```json
{"ok":true}
{"ok":true,"value":1}
```

失败响应：

```json
{ "ok": false, "error": "pin not configured" }
```

`mode` 支持 `input`、`output`、`input_pullup`。`digital_read` 返回 `value=0/1`；
`analog_read` 的量程由 MCU 固件定义，桌面端只透传数值。

## PnP 契约

- 图像帧先转 OpenCV HSV，按颜色提取最大轮廓并输出外接框。
- 外接框四角顺序为左上、右上、右下、左下。
- `solveCoplanarPnp` 使用相机内参和目标物理宽度解算 `target-in-camera` 位姿。
- 手眼外参再将其变换为 `target-in-base`；所有运行时位置单位为米，姿态为 rad。
