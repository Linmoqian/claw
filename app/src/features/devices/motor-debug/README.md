# 单电机调试

`serialDebug.ts` 只封装 Rust 串口命令；`session.ts` 保存界面状态及收发记录。TTL 与 RS485 使用串口参数和原始字节收发，其中 RS485 需要自动方向控制转接器。飞特 SCS/STS 的单 ID 查询、小步点动和批量位置读取由 Rust 串口会话执行。

CAN 目前支持虚拟串口上的 Lawicel SLCAN ASCII 协议。Rust 的 `slcan.rs` 负责握手、经典 CAN 报文下发与回执校验；`slcan.ts` 用于界面输入和日志格式化。不支持 CAN FD 或厂商私有 USB-CAN 驱动。报文格式依据 [LAWICEL CANUSB 手册](https://www.canusb.com/docs/canusb_manual.pdf)。离开页面时会话保留，可在工作台状态栏断开。
