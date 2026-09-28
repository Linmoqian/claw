# 调试协议层

`mod.rs` 在 Rust 中选择原始串口、飞特 SCS/STS、Lawicel SLCAN 或 BLE GATT 会话，并按当前协议分派调试命令。`feetech.rs` 和 `slcan.rs` 只负责报文编解码与回执校验；串口和蓝牙文件负责物理收发。原始模式可用于 TTL、RS485 或 CAN 适配器的虚拟串口，直通用户输入的字节，不附加设备指令；BLE GATT 也可按特征读写原始字节。旧 Tauri 命令保留兼容，调试页优先使用本层命令。
