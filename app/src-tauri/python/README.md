# Python 桥脚本

`zdtaichu_bridge.py` 是当前本地模型推理桥，由 Rust 管理进程。`servo_bridge.py` 保留为旧飞特 SDK 协议参考，桌面应用串口运行路径已由 Rust `backend/servo.rs` 接管；不再启动此脚本。
