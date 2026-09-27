# 后端模块

`servo.rs` 管理飞特 SDK 桥，`mcu.rs` 管理 MCU 串口，`debug_serial.rs` 管理单电机原始报文，`ai.rs` 管理模型桥。`common.rs` 只放跨模块错误转换与桥响应校验。新增 Tauri 命令在所属模块实现，并在 `lib.rs` 注册。

`experiments.rs` 将实验元信息、快照和采样分块写入应用数据目录。每次提交生成新清单；临时文件和未引用采样块不会参与读取，旧 IndexedDB 记录在前端首次读取时分批迁入且不删除原数据。
