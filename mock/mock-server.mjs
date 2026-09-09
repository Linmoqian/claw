/**
 * claw 假数据源（Mock Data Source）
 *  - robot WS   默认 ws://127.0.0.1:15551   50Hz  robot_state
 *  - station WS 默认 ws://127.0.0.1:15552   10Hz  station_position
 * 均回 pong；robot 每 2s 补发 device_status。
 * 用法：npm i && npm start（端口/频率可用环境变量覆盖）
 */
import { WebSocketServer } from "ws";

const ROBOT_PORT = Number(process.env.ROBOT_PORT ?? 15551);
const STATION_PORT = Number(process.env.STATION_PORT ?? 15552);
const ROBOT_HZ = Number(process.env.ROBOT_HZ ?? 50);
const STATION_HZ = Number(process.env.STATION_HZ ?? 10);
const PROTOCOL_VERSION = 1;

/** 椭圆闭环轨迹参数 */
const LOOP = {
  cx: 12.31,
  cy: 4.82,
  rx: 0.5,
  ry: 0.5,
  periodSec: 8,
};

const envelope = (type, data, source) => ({
  version: PROTOCOL_VERSION,
  type,
  timestamp: Date.now(),
  source,
  data,
});

const safeParse = (text) => {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

function robotPoseAt(tSec) {
  const w = (2 * Math.PI) / LOOP.periodSec;
  const x = LOOP.cx + LOOP.rx * Math.sin(w * tSec);
  const y = LOOP.cy + LOOP.ry * Math.cos(w * tSec);
  // 数值速度 + 面向运动方向的航向
  const vx = LOOP.rx * w * Math.cos(w * tSec);
  const vy = -LOOP.ry * w * Math.sin(w * tSec);
  const linear = Math.hypot(vx, vy);
  const yaw = Math.atan2(vy, vx);
  return { x, y, yaw, linear, angular: w };
}

/** WS 服务骨架：广播 + pong 应答 + 连接日志（setImmediate 自适应调度，
 *  避开 Windows 定时器 15.6ms 分辨率导致的低频） */
function startStreamServer(port, name, sampler, hz) {
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  wss.on("connection", (ws) => {
    console.log(`[mock] ${name} client connected (${wss.clients.size})`);
    ws.on("message", (raw) => {
      const msg = safeParse(String(raw));
      if (msg?.type === "ping") {
        ws.send(JSON.stringify(envelope("pong", {}, name)));
      }
    });
    ws.on("close", () => {
      console.log(`[mock] ${name} client closed (${wss.clients.size})`);
    });
  });
  wss.on("error", (e) => {
    console.error(`[mock] ${name} server error:`, e.message);
  });
  const tickMs = 1000 / hz;
  let next = performance.now();
  let stopped = false;
  const pump = () => {
    if (stopped) return;
    const now = performance.now();
    if (now >= next && wss.clients.size > 0) {
      const text = JSON.stringify(sampler());
      for (const client of wss.clients) client.send(text);
      next += tickMs;
      if (next < now - 10 * tickMs) next = now; // 空闲后追上
    }
    setImmediate(pump);
  };
  setImmediate(pump);
  console.log(`[mock] ${name}:${port} up, ${hz}Hz`);
  return { wss, stop: () => (stopped = true) };
}

const robot = startStreamServer(ROBOT_PORT, "robot", () => {
  const t = Date.now() / 1000;
  const p = robotPoseAt(t);
  return envelope(
    "robot_state",
    {
      pose: { x: p.x, y: p.y, yaw: p.yaw },
      velocity: { linear: p.linear, angular: p.angular },
    },
    "x_line_bot_mock",
  );
}, ROBOT_HZ);

const station = startStreamServer(STATION_PORT, "station", () => {
  const t = Date.now() / 1000;
  const p = robotPoseAt(t);
  // 恒定偏移 + ~1mm 噪声：定位误差 dx≈+7~9mm, dy≈-2~-4mm
  const noise = () => (Math.random() - 0.5) * 0.002;
  return envelope(
    "station_position",
    {
      robot_id: 1,
      x: p.x + 0.008 + noise(),
      y: p.y - 0.003 + noise(),
      z: 0,
      valid: true,
    },
    "total_station_mock",
  );
}, STATION_HZ);

// robot 端附加 device_status 心跳语义（上层主要依赖 robot_state 的 50Hz 活性）
const statusTimer = setInterval(() => {
  if (robot.wss.clients.size === 0) return;
  const text = JSON.stringify(
    envelope("device_status", { device: "robot", connected: true }, "x_line_bot_mock"),
  );
  for (const client of robot.wss.clients) client.send(text);
}, 2000);

process.on("SIGINT", () => {
  robot.stop();
  station.stop();
  clearInterval(statusTimer);
  robot.wss.close();
  station.wss.close();
  process.exit(0);
});

console.log(
  `[mock] up → robot ws://127.0.0.1:${ROBOT_PORT} ${ROBOT_HZ}Hz · station ws://127.0.0.1:${STATION_PORT} ${STATION_HZ}Hz`,
);