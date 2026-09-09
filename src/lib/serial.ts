/**
 * 串口/舵机 Tauri command 封装。
 *
 * 所有调用仅在桌面端（Tauri）有效；浏览器端由调用方给出占位提示，不产生数据。
 * 参考 `src-tauri/src/lib.rs` 中的同名 command。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** 当前是否运行在 Tauri 桌面端。 */
export const isDesktop = isTauri;

/** sync_read_positions 单电机读数。 */
export type MotorReading = {
  id: number;
  /** 原始位置（0-4095） */
  position: number;
  ok: boolean;
  error: string;
};

/** 列出系统可用串口名。对应 `list_serial_ports`。 */
export async function listSerialPorts(): Promise<string[]> {
  return invoke<string[]>("list_serial_ports");
}

/** 打开串口建立会话，返回端口名。对应 `serial_connect`。 */
export async function serialConnect(port: string, baud: number): Promise<string> {
  return invoke<string>("serial_connect", { port, baud });
}

/** 关闭串口释放会话。对应 `serial_disconnect`。 */
export async function serialDisconnect(): Promise<void> {
  await invoke("serial_disconnect");
}

/** 是否已建立会话。对应 `serial_is_connected`。 */
export async function serialIsConnected(): Promise<boolean> {
  return invoke<boolean>("serial_is_connected");
}

/** 单点 ping，返回型号号。对应 `servo_ping`。 */
export async function servoPing(id: number): Promise<number> {
  return invoke<number>("servo_ping", { id });
}

/** 启用/禁用扭矩。对应 `servo_set_torque`。 */
export async function servoSetTorque(id: number, on: boolean): Promise<void> {
  await invoke("servo_set_torque", { id, on });
}

/** 读当前位置（0-4095）。对应 `servo_read_position`。 */
export async function servoReadPosition(id: number): Promise<number> {
  return invoke<number>("servo_read_position", { id });
}

/** 写目标位置（0-4095）。对应 `servo_write_position`。 */
export async function servoWritePosition(id: number, position: number): Promise<void> {
  await invoke("servo_write_position", { id, position });
}

/** 批量读多个电机位置。对应 `servo_sync_read_positions`。 */
export async function servoSyncReadPositions(ids: number[]): Promise<MotorReading[]> {
  return invoke<MotorReading[]>("servo_sync_read_positions", { ids });
}
