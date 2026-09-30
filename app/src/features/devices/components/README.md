# devices/components

单电机调试台（pages/MotorDebug）拆分出的区块组件：通信连接表单、飞特舵机面板、CAN 帧收发面板、原始报文面板与调试日志面板。组件各自订阅 `motor-debug/session` 的 zustand store 切片，仅跨面板共享的表单态经 props 传入。
