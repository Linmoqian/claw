# 单电机调试

`serialDebug.ts` 只封装 Rust 协议层命令；`session.ts` 保存界面状态及收发记录。Rust 根据接口和协议一次性完成选择、连接和必要握手，原始模式直通字节。TTL 与 RS485 使用串口参数，其中 RS485 需要自动方向控制转接器。飞特 SCS/STS 的单 ID 查询、小步点动和批量位置读取由 Rust 串口会话执行。

CAN 目前支持虚拟串口上的 Lawicel SLCAN ASCII 协议。Rust 的 `protocol/slcan.rs` 负责编解码与回执校验，`slcan.rs` 负责串口握手和收发；前端 `slcan.ts` 只用于日志格式化。不支持 CAN FD 或厂商私有 USB-CAN 驱动。报文格式依据 [LAWICEL CANUSB 手册](https://www.canusb.com/docs/canusb_manual.pdf)。离开页面时会话保留，可在工作台状态栏断开。
