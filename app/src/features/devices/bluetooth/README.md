# BLE GATT

`ble.ts` 只封装 Tauri 命令和数据类型，`BleDebug.tsx` 提供调试界面与当前会话日志。扫描、连接、特征发现、读写与通知均由 Rust 的 `backend/bluetooth.rs` 执行。调用方须先扫描再连接，写入前先检查特征支持的方式；没有设备协议时不推断电机控制报文。普通浏览器没有这些 Tauri 命令。
