// 最小 mock 遥测 WS 服务器：握手后 20Hz 推 robot_state（关节正弦摆动 + 底盘画圆），打印收到的 command
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = 15551;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const srv = createServer((req, res) => {
  res.writeHead(426).end("websocket only");
});

srv.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  console.log("[mock-ws] client connected");
  let i = 0;
  const t = setInterval(() => {
    const joints = {};
    ["J1", "J2", "J3", "J4", "J5", "J6"].forEach((k, idx) => {
      joints[k] = Math.sin((i / 20 + idx) * 0.7) * 40;
    });
    const msg = {
      version: 1,
      type: "robot_state",
      timestamp: Date.now(),
      data: {
        pose: {
          x: Math.cos(i / 80) * 0.3,
          y: Math.sin(i / 80) * 0.3,
          yaw: i / 80 + Math.PI / 2,
        },
        joints,
      },
    };
    sendText(socket, JSON.stringify(msg));
    i++;
  }, 50);

  // 客户端帧（command）：只解析非掩码长度头（本项目客户端发的是小消息，掩码帧解析最小化）
  socket.on("data", (buf) => {
    const opcode = buf[0] & 0x0f;
    if (opcode === 0x1 || opcode === 0x2) {
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        len = buf.readUInt16BE(2);
        off = 4;
      }
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        off += 4;
        const payload = buf.subarray(off, off + len);
        const out = Buffer.from(payload);
        for (let k = 0; k < out.length; k++) out[k] ^= mask[k % 4];
        console.log("[mock-ws] command:", out.toString());
      }
    }
    if (opcode === 0x8) {
      clearInterval(t);
      socket.destroy();
    }
  });
  socket.on("close", () => {
    clearInterval(t);
    console.log("[mock-ws] client disconnected");
  });
});

function sendText(socket, text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

srv.listen(PORT, () => console.log(`[mock-ws] listening on ws://127.0.0.1:${PORT}`));
