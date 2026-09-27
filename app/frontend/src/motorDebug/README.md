# 单电机调试

`serialDebug.ts` 封装桌面端原始串口命令；`session.ts` 保存当前调试会话及收发记录。TTL 与 RS485 使用串口参数和原始字节收发，其中 RS485 需要自动方向控制转接器。飞特 SCS/STS 可使用已有 SDK 桥进行单 ID 查询和小步点动。

CAN 目前支持虚拟串口上的 Lawicel SLCAN ASCII 协议。`slcan.ts` 负责经典 CAN 的标准帧、扩展帧与速率命令，不支持 CAN FD 或厂商私有 USB-CAN 驱动。报文格式依据 [LAWICEL CANUSB 手册](https://www.canusb.com/docs/canusb_manual.pdf)。离开页面时会话保留，可在工作台状态栏断开。
