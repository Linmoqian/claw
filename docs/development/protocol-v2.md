# M7 Wire Protocol v2

协议边界只接受 v2，不兼容含糊的 v1 消息。Wire 数据统一使用 SI：位置 `m`、
关节位置 `rad`、线速度 `m/s`、角速度 `rad/s`、时间 `s`。

每条消息必须包含 `protocol_version`、`units`、`frame_id`、`timestamp`、
`sequence`、`type` 和 `data`。`timestamp` 是 Unix 秒；进入前端运行时后，
协议适配层将其转换为 epoch ms。同一 `source` 的 `sequence` 必须严格递增，
Bridge 会丢弃重复或倒序消息。

关节状态固定为：

```json
{
  "type": "joint_state",
  "data": {
    "names": ["J1", "J2"],
    "position_rad": [0.1, -0.2]
  }
}
```

机器人位姿使用 `position_m / orientation_xyzw / yaw_rad`，速度使用
`linear_mps / angular_radps`。控制命令同样只使用带单位字段；UI 显示的角度
仅允许在 Studio 与 Bridge 的边界进行 `° ↔ rad` 转换。

命令载荷必须携带 `command_id` 和生命周期。当前封板定义完整状态机，发送时
进入 `DISPATCHED`；后续 M8/M9 再接执行回执与失败处理。
