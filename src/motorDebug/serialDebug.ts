/** 单电机原始串口边界。Created on 2026-09-27 @author: https://github.com/Linmoqian */
import { invoke } from "@tauri-apps/api/core";

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
