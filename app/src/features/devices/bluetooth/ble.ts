/** BLE GATT 的 Tauri 命令类型封装。Created on 2026-09-28; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
import { Channel, invoke } from "@tauri-apps/api/core";

export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface BleCharacteristic {
  serviceUuid: string;
  uuid: string;
  canRead: boolean;
  canWrite: boolean;
  canWriteWithoutResponse: boolean;
  canNotify: boolean;
}

export interface BleNotification {
  uuid: string;
  value: number[];
}

export const scanBle = (durationMs = 3000): Promise<BleDevice[]> =>
  invoke("bluetooth_scan", { durationMs });

export const connectBle = (id: string): Promise<BleCharacteristic[]> =>
  invoke("bluetooth_connect", { id });

export const disconnectBle = (): Promise<void> => invoke("bluetooth_disconnect");

export const listBleCharacteristics = (): Promise<BleCharacteristic[]> =>
  invoke("bluetooth_characteristics");

export const readBle = (uuid: string): Promise<number[]> =>
  invoke("bluetooth_read", { uuid });

export const writeBle = (
  uuid: string,
  value: number[],
  withResponse = true,
): Promise<void> => invoke("bluetooth_write", { uuid, value, withResponse });

export function subscribeBle(
  uuid: string,
  onNotification: (event: BleNotification) => void,
): Promise<void> {
  const channel = new Channel<BleNotification>();
  channel.onmessage = onNotification;
  return invoke("bluetooth_subscribe", { uuid, channel });
}

export const unsubscribeBle = (uuid: string): Promise<void> =>
  invoke("bluetooth_unsubscribe", { uuid });
