# 后端模块

`servo.rs` 管理飞特 SDK 桥，`mcu.rs` 管理 MCU 串口，`debug_serial.rs` 管理单电机原始报文，`ai.rs` 管理模型桥。`common.rs` 只放跨模块错误转换与桥响应校验。新增 Tauri 命令在所属模块实现，并在 `lib.rs` 注册。
