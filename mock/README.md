# claw-mock 假数据源

V2 阶段二的测试假数据源：单进程双 WebSocket 端口。

| 端 | 地址 | 频率 | 载荷 |
|---|---|---|---|
| robot | `ws://127.0.0.1:15551` | 50Hz | `robot_state`（椭圆闭环轨迹 + 面向运动方向 yaw + 速度）、每 2s `device_status` |
| station | `ws://127.0.0.1:15552` | 10Hz | `station_position`（robot 位置 + ~8mm/-3mm 恒定偏差 + 1mm 噪声） |

运行：

```bash
cd claw/mock
npm install
npm start
```

或从工程根：`node mock/mock-server.mjs`（先 `npm install` 过）。

环境变量：`ROBOT_PORT` `STATION_PORT` `ROBOT_HZ` `STATION_HZ`（默认 15551/15552/50/10）。

协议：与 `src/services/protocol/message.ts` 完全对齐——envelope `{version, type, timestamp, source, data}`，含 `ping`/`pong` 探活。