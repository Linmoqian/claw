# -*- coding: utf-8 -*-
# claw 串口舵机桥：stdin 逐行读 JSON 请求 → scservo_sdk（飞特官方 Python SDK）执行 → stdout 写一行 JSON 响应。
# 宿主（Rust/Tauri）退出后 stdin EOF，循环自然结束；atexit 兜底释放串口。
# Created on 2026-09-11
# @author:  https://github.com/Linmoqian

import atexit
import json
import sys

from scservo_sdk import (
    COMM_SUCCESS,
    GroupSyncRead,
    PacketHandler,
    PortHandler,
)

# SCS/STS 系列控制表地址（Feetech 公开手册；SDK 只含协议层，不含控制表常量）
ADDR_TORQUE_ENABLE = 40
ADDR_GOAL_POSITION = 42     # 2 字节
ADDR_PRESENT_POSITION = 56  # 2 字节

# 串口会话（同一时刻至多一个，串口半双工本就串行）
_session = {}


def _resp(ok, data=None, error=""):
    print(json.dumps({"ok": ok, "data": data, "error": error}, ensure_ascii=False), flush=True)


def _shutdown_port():
    if _session.get("port"):
        _session["port"].closePort()
    _session.clear()


def _need_session():
    if not _session:
        raise RuntimeError("设备未连接")
    return _session["port"], _session["ph"]


def cmd_connect(req):
    if _session:
        raise RuntimeError("设备已连接，请先断开")
    port_name = req["port"]
    baud = int(req["baud"])
    port = PortHandler(port_name)
    # 白名单校验（4800..1000000），无效波特率直接拒绝——与原 scservo-rs 行为一致
    if port.getCFlagBaud(baud) <= 0:
        raise RuntimeError(f"不支持的波特率：{baud}")
    port.baudrate = baud
    # 一次打开到位（避免 openPort 默认 1e6 打开后再切换的重复开合）
    if not port.openPort():
        raise RuntimeError(f"无法打开串口 {port_name}（波特率 {baud}）")
    _session["port"] = port
    _session["ph"] = PacketHandler(0)  # 0 = SCS 协议（小端）
    return None


def cmd_disconnect(_req):
    _shutdown_port()
    return None


def cmd_ping(req):
    port, ph = _need_session()
    model, result, _err = ph.ping(port, int(req["id"]))
    if result != COMM_SUCCESS:
        raise RuntimeError(ph.getTxRxResult(result))
    return model


def cmd_set_torque(req):
    port, ph = _need_session()
    result, _err = ph.write1ByteTxRx(
        port,
        int(req["id"]),
        ADDR_TORQUE_ENABLE,
        1 if req["on"] else 0
    )
    if result != COMM_SUCCESS:
        raise RuntimeError(ph.getTxRxResult(result))
    return None


def cmd_read_position(req):
    port, ph = _need_session()
    pos, result, _err = ph.read2ByteTxRx(port, int(req["id"]), ADDR_PRESENT_POSITION)
    if result != COMM_SUCCESS:
        raise RuntimeError(ph.getTxRxResult(result))
    return pos


def cmd_write_position(req):
    port, ph = _need_session()
    result, _err = ph.write2ByteTxRx(
        port,
        int(req["id"]),
        ADDR_GOAL_POSITION,
        int(req["position"])
    )
    if result != COMM_SUCCESS:
        raise RuntimeError(ph.getTxRxResult(result))
    return None


def cmd_sync_read_positions(req):
    port, ph = _need_session()
    ids = [int(i) for i in req["ids"]]
    if not ids:
        return []
    gsr = GroupSyncRead(port, ph, ADDR_PRESENT_POSITION, 2)
    for i in ids:
        gsr.addParam(i)
    result = gsr.txRxPacket()
    # 整体通信失败时逐项返回失败（ok=false），便于前端区分「某电机掉线」与「整体异常」
    msg = "" if result == COMM_SUCCESS else ph.getTxRxResult(result)
    out = []
    for i in ids:
        if result == COMM_SUCCESS and gsr.isAvailable(i, ADDR_PRESENT_POSITION, 2):
            out.append({"id": i, "position": gsr.getData(i, ADDR_PRESENT_POSITION, 2), "ok": True, "error": ""})
        else:
            out.append({"id": i, "position": 0, "ok": False, "error": msg or "no data"})
    return out


COMMANDS = {
    "connect": cmd_connect,
    "disconnect": cmd_disconnect,
    "ping": cmd_ping,
    "set_torque": cmd_set_torque,
    "read_position": cmd_read_position,
    "write_position": cmd_write_position,
    "sync_read_positions": cmd_sync_read_positions,
}


def main():
    atexit.register(_shutdown_port)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            handler = COMMANDS.get(req.get("cmd"))
            if handler is None:
                raise RuntimeError(f"未知命令：{req.get('cmd')}")
            _resp(True, data=handler(req))
        except Exception as exc:  # 任何异常都以 error 响应回报，桥进程不崩
            _resp(False, error=str(exc))


if __name__ == "__main__":
    main()
