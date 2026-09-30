/** BLE GATT 原始字节调试界面。Created on 2026-09-28; Updated on 2026-09-28 @author: https://github.com/Linmoqian */
import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, Radio, RotateCw, Trash2 } from "lucide-react";
import EmptyState from "../../../components/EmptyState";
import { isDesktop } from "../../../lib/serial";
import { formatHexBytes, parseHexBytes } from "../motor-debug/serialDebug";
import {
  connectBle,
  disconnectBle,
  listBleCharacteristics,
  readBle,
  scanBle,
  subscribeBle,
  unsubscribeBle,
  writeBle,
  type BleCharacteristic,
  type BleDevice,
} from "./ble";

interface LogLine { id: number; at: number; direction: "TX" | "RX" | "SYS" | "ERR"; message: string }
interface Props { onConnectionChange: (connected: boolean) => void }

export default function BleDebug({ onConnectionChange }: Props) {
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState(false);
  const [characteristics, setCharacteristics] = useState<BleCharacteristic[]>([]);
  const [uuid, setUuid] = useState("");
  const [payload, setPayload] = useState("");
  const [withResponse, setWithResponse] = useState(true);
  const [subscribedUuid, setSubscribedUuid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const desktop = isDesktop();
  const target = characteristics.find((item) => item.uuid === uuid);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void listBleCharacteristics().then((found) => {
      if (!active) return;
      setCharacteristics(found);
      setUuid(found[0]?.uuid ?? "");
      setConnected(true);
      onConnectionChange(true);
    }).catch(() => {
      if (active) onConnectionChange(false);
    });
    return () => { active = false; };
  }, [desktop, onConnectionChange]);

  function log(direction: LogLine["direction"], message: string): void {
    setLogs((lines) => [...lines, { id: Date.now() + Math.random(), at: Date.now(), direction, message }].slice(-200));
  }

  async function run(task: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try { await task(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      log("ERR", message);
    } finally { setBusy(false); }
  }

  function send(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      const bytes = parseHexBytes(payload);
      await writeBle(uuid, bytes, withResponse);
      log("TX", `${uuid} · ${formatHexBytes(bytes)}`);
    });
  }

  return (
    <div className="motor-debug">
      <header className="motor-debug__header"><div>
        <span className="motor-debug__eyebrow">实验操作 / BLE GATT</span>
        <h1>蓝牙调试</h1>
        <p>扫描设备，连接 GATT 特征，再读取、写入或订阅原始字节。</p>
      </div><span className={`motor-debug__status ${connected ? "is-connected" : ""}`}><Radio size={15} /> {connected ? "已连接" : "未连接"}</span></header>
      {!desktop && <div className="motor-debug__notice" role="status"><CircleAlert size={17} /> 浏览器仅供界面预览；BLE 通信需要 Tauri 桌面应用。</div>}
      {error && <div className="motor-debug__notice is-error" role="alert"><CircleAlert size={17} /> {error}</div>}
      <div className="motor-debug__layout"><div className="motor-debug__controls">
        <section className="motor-debug__panel"><div className="motor-debug__panel-head"><span className="motor-debug__number">01</span><div><h2>设备连接</h2><p>先扫描附近的 BLE 外设。</p></div></div>
          <label>设备
            <select value={selected} disabled={connected || busy} onChange={(event) => setSelected(event.target.value)}>
              <option value="">选择扫描结果</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name || "未命名设备"} · {device.id} {device.rssi === null ? "" : `· ${device.rssi} dBm`}</option>)}
            </select>
          </label>
          <div className="motor-debug__actions">
            <button type="button" className="motor-debug__button" disabled={!desktop || busy || connected} onClick={() => void run(async () => {
              const found = await scanBle(); setDevices(found); setSelected(found[0]?.id ?? ""); log("SYS", `发现 ${found.length} 个 BLE 设备`);
            })}><RotateCw size={15} /> 扫描</button>
            {connected ? <button type="button" className="motor-debug__button" disabled={busy} onClick={() => void run(async () => {
              await disconnectBle(); setConnected(false); onConnectionChange(false); setCharacteristics([]); setUuid(""); setSubscribedUuid(null); log("SYS", "已断开 BLE 连接");
            })}>断开</button> : <button type="button" className="motor-debug__button is-primary" disabled={!desktop || busy || !selected} onClick={() => void run(async () => {
              const found = await connectBle(selected); setCharacteristics(found); setUuid(found[0]?.uuid ?? ""); setConnected(true); onConnectionChange(true); log("SYS", `已连接 · 发现 ${found.length} 个特征`);
            })}>连接</button>}
          </div>
        </section>
        <section className="motor-debug__panel"><div className="motor-debug__panel-head"><span className="motor-debug__number">02</span><div><h2>GATT 特征</h2><p>依据设备协议选择特征及写入方式。</p></div></div>
          <label>服务 / 特征 UUID
            <select value={uuid} disabled={!connected || busy} onChange={(event) => setUuid(event.target.value)}>
              {characteristics.length ? characteristics.map((item) => <option key={`${item.serviceUuid}:${item.uuid}`} value={item.uuid}>{item.serviceUuid} / {item.uuid}</option>) : <option value="">连接后显示特征</option>}
            </select>
          </label>
          {target && <p className="motor-debug__hint">{[target.canRead && "读取", target.canWrite && "有响应写入", target.canWriteWithoutResponse && "无响应写入", target.canNotify && "通知"].filter(Boolean).join(" · ") || "此特征无可用操作"}</p>}
          <div className="motor-debug__actions">
            <button type="button" className="motor-debug__button" disabled={!target?.canRead || busy} onClick={() => void run(async () => log("RX", `${uuid} · ${formatHexBytes(await readBle(uuid))}`))}>读取</button>
            {subscribedUuid === uuid ? <button type="button" className="motor-debug__button" disabled={busy} onClick={() => void run(async () => {
              await unsubscribeBle(uuid); setSubscribedUuid(null); log("SYS", `已取消订阅 ${uuid}`);
            })}>取消订阅</button> : <button type="button" className="motor-debug__button" disabled={!target?.canNotify || busy || subscribedUuid !== null} onClick={() => void run(async () => {
              await subscribeBle(uuid, (item) => log("RX", `${item.uuid} · ${formatHexBytes(item.value)}`)); setSubscribedUuid(uuid); log("SYS", `已订阅 ${uuid}`);
            })}>订阅通知</button>}
          </div>
          <form className="motor-debug__send-form" onSubmit={send}>
            <label>十六进制发送内容<textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={4} placeholder="例如 01 02 03" /></label>
            <label>写入方式<select value={withResponse ? "response" : "without"} onChange={(event) => setWithResponse(event.target.value === "response")}><option value="response">有响应</option><option value="without">无响应</option></select></label>
            <div className="motor-debug__actions"><button type="submit" className="motor-debug__button is-primary" disabled={!desktop || busy || !payload.trim() || !(withResponse ? target?.canWrite : target?.canWriteWithoutResponse)}>写入特征</button></div>
          </form>
          <p className="motor-debug__hint">本页仅收发原始 GATT 字节。写入前请确认设备协议及负载含义；实际单包长度受设备 MTU 限制。</p>
        </section>
      </div><section className="motor-debug__panel motor-debug__log"><div className="motor-debug__log-head"><div><span className="motor-debug__number">03</span><h2>通信记录</h2></div><button type="button" disabled={!logs.length} onClick={() => setLogs([])}><Trash2 size={14} /> 清空</button></div>
        {logs.length ? <ol aria-live="polite">{logs.map((line) => <li key={line.id} className={line.direction === "RX" ? "is-rx" : line.direction === "ERR" ? "is-error" : ""}><time>{new Date(line.at).toLocaleTimeString("zh-CN", { hour12: false })}</time><span>{line.direction}</span><code>{line.message}</code></li>)}</ol> : <EmptyState className="motor-debug__empty" icon={Radio} iconSize={24} title="等待通信记录" hint="扫描、收发和错误会显示在这里。" />}
        <div className="motor-debug__log-foot">最多保留最近 200 条记录，当前会话内存保存。</div>
      </section></div>
    </div>
  );
}
