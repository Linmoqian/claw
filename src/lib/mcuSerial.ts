/**
 * 通用 MCU 串口桥 Tauri command 封装。
 *
 * JSON 行协议由外部 MCU 固件实现；该会话与 Feetech 舵机会话相互独立。
 *
 * Created on 2026-09-21
 * @author:  https://github.com/Linmoqian
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export const isDesktop = isTauri;

export async function mcuSerialOpen(
  port: string,
  baud: number,
): Promise<string> {
  return invoke<string>("mcu_serial_open", { port, baud });
}

export async function mcuSerialClose(): Promise<void> {
  await invoke("mcu_serial_close");
}

export async function mcuSerialIsOpen(): Promise<boolean> {
  return invoke<boolean>("mcu_serial_is_open");
}

export async function mcuSerialSend(payload: string): Promise<void> {
  await invoke("mcu_serial_send", { payload });
}

export async function mcuSerialReadLine(timeoutMs: number): Promise<string> {
  return invoke<string>("mcu_serial_read_line", { timeoutMs });
}
