/** Lawicel SLCAN 输入校验与界面日志解析。Created on 2026-09-27; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
// 协议参考：https://www.canusb.com/docs/canusb_manual.pdf
export const CAN_BITRATES = [
  { code: "S0", label: "10 kbit/s" },
  { code: "S1", label: "20 kbit/s" },
  { code: "S2", label: "50 kbit/s" },
  { code: "S3", label: "100 kbit/s" },
  { code: "S4", label: "125 kbit/s" },
  { code: "S5", label: "250 kbit/s" },
  { code: "S6", label: "500 kbit/s" },
  { code: "S7", label: "800 kbit/s" },
  { code: "S8", label: "1 Mbit/s" },
] as const;

export type CanBitrateCode = (typeof CAN_BITRATES)[number]["code"];
export interface CanFrame {
  id: number;
  extended: boolean;
  data: number[];
}

export function encodeSlcanCommand(command: string): number[] {
  return Array.from(new TextEncoder().encode(`${command}\r`));
}

export function encodeSlcanFrame(frame: CanFrame): string {
  const maxId = frame.extended ? 0x1fffffff : 0x7ff;
  if (!Number.isInteger(frame.id) || frame.id < 0 || frame.id > maxId)
    throw new Error(
      frame.extended ? "扩展帧 ID 须在 0–1FFFFFFF。" : "标准帧 ID 须在 0–7FF。",
    );
  if (
    frame.data.length > 8 ||
    frame.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  )
    throw new Error("经典 CAN 数据区最多 8 字节，字节范围为 00–FF。");
  const kind = frame.extended ? "T" : "t";
  const id = frame.id
    .toString(16)
    .toUpperCase()
    .padStart(frame.extended ? 8 : 3, "0");
  const data = frame.data
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
  return `${kind}${id}${frame.data.length}${data}`;
}

export function decodeSlcanRecords(
  bytes: number[],
  carry = "",
): { records: string[]; carry: string } {
  // 适配器报错可能只发 BEL 而不附带 CR。
  const text = (carry + String.fromCharCode(...bytes))
    .split("\x07\r").join("\x07")
    .split("\x07").join("\x07\r");
  const chunks = text.split("\r");
  const nextCarry = chunks.pop() ?? "";
  return { records: chunks, carry: nextCarry };
}

export function describeSlcanRecord(record: string): string {
  if (record.includes("\x07")) return "适配器拒绝命令（BELL）";
  if (!record || record === "z" || record === "Z") return "适配器已确认";
  if (["t", "T", "r", "R"].includes(record[0])) {
    const extended = record[0] === "T" || record[0] === "R";
    const remote = record[0] === "r" || record[0] === "R";
    const idLength = extended ? 8 : 3;
    const dlc = Number.parseInt(record[1 + idLength] ?? "", 16);
    const id = record.slice(1, 1 + idLength);
    const payload = record.slice(
      2 + idLength,
      2 + idLength + (remote ? 0 : dlc * 2),
    );
    if (
      !Number.isInteger(dlc) ||
      dlc < 0 ||
      dlc > 8 ||
      payload.length !== (remote ? 0 : dlc * 2) ||
      !/^[0-9a-f]*$/i.test(payload)
    )
      return `未识别记录：${record}`;
    return `CAN ${extended ? "29" : "11"} 位${remote ? " RTR" : ""} ID 0x${id.toUpperCase()} · DLC ${dlc}${payload ? ` · ${payload.match(/../g)?.join(" ").toUpperCase()}` : ""}`;
  }
  return `适配器记录：${record}`;
}
