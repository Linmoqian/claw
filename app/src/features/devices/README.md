# 设备

`api/` 提供电机、无人机、机械臂、舵机、激光雷达五类对外设备契约；`pages/` 放调试界面；`motor-debug/` 放串口与 CAN 的界面会话，`bluetooth/` 放 BLE GATT 界面。协议选择、报文编解码和物理收发由 Rust 后端负责。
