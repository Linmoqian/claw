/** Rust 串口命令的前端类型封装。Created on 2026-09-27; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
import { invoke } from "@tauri-apps/api/core";
import type { CanBitrateCode, CanFrame } from "./slcan";

export type RawSerialParity = "none" | "even" | "odd";
export interface RawSerialOptions {
  port: string;
  baud: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: RawSerialParity;
  stopBits: 1 | 2;
}

export function parseHexBytes(source: string): number[] {
  const normalized = source.replace(/(?:0x)/gi, "").replace(/[\s,;:_-]/g, "");
  if (
    !normalized ||
    normalized.length % 2 !== 0 ||
    /[^0-9a-f]/i.test(normalized)
  ) {
    throw new Error("请填写偶数位十六进制字节，例如 FF FF 01 02。");
  }
  if (normalized.length > 1024) throw new Error("单次发送最多 512 字节。");
  return normalized.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
}

export function formatHexBytes(bytes: number[]): string {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

export async function openRawSerial(
  options: RawSerialOptions,
): Promise<string> {
  return invoke<string>("debug_serial_open", {
    port: options.port,
    baud: options.baud,
    dataBits: options.dataBits,
    parity: options.parity,
    stopBits: options.stopBits,
  });
}

export async function closeRawSerial(): Promise<void> {
  await invoke("debug_serial_close");
}

export async function transferRawSerial(
  tx: number[],
  timeoutMs: number,
): Promise<number[]> {
  return invoke<number[]>("debug_serial_transfer", { tx, timeoutMs });
}

export async function initializeSlcan(bitrate: CanBitrateCode): Promise<void> {
  await invoke("slcan_initialize", { bitrate });
}

export async function closeSlcan(): Promise<void> {
  await invoke("slcan_close");
}

export async function sendSlcanFrame(frame: CanFrame): Promise<number[]> {
  return invoke<number[]>("slcan_send_frame", { frame });
}

export async function receiveSlcanFrames(): Promise<number[]> {
  return invoke<number[]>("slcan_receive");
}
