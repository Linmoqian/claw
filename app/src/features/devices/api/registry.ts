// 对外设备发现入口。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian
import type { DeviceKind, ExternalDevice } from "./contracts";

/** 只注册真实适配器；类别声明本身不表示硬件或驱动已经接入。 */
export class DeviceRegistry {
  private readonly devices = new Map<string, ExternalDevice>();

  register(device: ExternalDevice): () => void {
    if (!device.id.trim()) throw new Error("设备 ID 不能为空");
    if (this.devices.has(device.id)) throw new Error(`设备 ID 已存在：${device.id}`);
    this.devices.set(device.id, device);
    return () => {
      if (this.devices.get(device.id) === device) this.devices.delete(device.id);
    };
  }

  get(id: string): ExternalDevice | undefined {
    return this.devices.get(id);
  }

  list(kind?: DeviceKind): ExternalDevice[] {
    return [...this.devices.values()].filter((device) => !kind || device.kind === kind);
  }
}
