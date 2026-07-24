import { useEffect, useRef } from "react";
import type { Motor, PidGains } from "../types";

type Props = {
  motor: Motor;
  pid: PidGains;
  running: boolean;
};

const BUFFER = 480; // 采样点数
const STEP_HZ = 120; // 仿真步频
const PERIOD_MS = 3000; // 阶跃周期

/**
 * Canvas 实时波形 + PID 仿真。
 * 仿真模型为简化积分环节：pv 对 PID 输出积分，Kp/Ki/Kd 实时影响响应曲线。
 */
export default function WaveCanvas({ motor, pid, running }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pidRef = useRef(pid);
  const motorRef = useRef(motor);
  const runningRef = useRef(running);

  pidRef.current = pid;
  motorRef.current = motor;
  runningRef.current = running;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let phaseTimer = 0;

    // 仿真状态
    const state = {
      sp: 0,
      pv: 0,
      integral: 0,
      lastErr: 0,
    };

    const spBuf = new Float32Array(BUFFER);
    const pvBuf = new Float32Array(BUFFER);
    let writeIdx = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const amp = () => Math.max(20, (motorRef.current.max - motorRef.current.min) * 0.32);

    const step = (dt: number) => {
      // 周期阶跃：在 +amp / -amp 之间翻转
      phaseTimer += dt;
      const target = phaseTimer % (PERIOD_MS / 1000) < PERIOD_MS / 2000 ? amp() : -amp();
      state.sp = target;

      const { kp, ki, kd } = pidRef.current;
      const err = state.sp - state.pv;
      state.integral += err * dt;
      // 抗饱和：积分限幅
      const iLimit = amp() * 1.5;
      state.integral = Math.max(-iLimit, Math.min(iLimit, state.integral));
      const deriv = (err - state.lastErr) / dt;
      state.lastErr = err;

      const output = kp * err + ki * state.integral + kd * deriv;
      // 被控对象：积分环节 + 轻微阻尼
      state.pv += output * dt * 0.06;
      state.pv *= 0.998;
    };

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const max = amp() * 1.35;
      const padTop = 14;
      const padBot = 18;
      const usable = height - padTop - padBot;
      const yOf = (v: number) =>
        padTop + usable * (0.5 - (Math.max(-max, Math.min(max, v)) / (max * 2)));

      // 网格
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (usable * i) / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 8; i++) {
        const x = (width * i) / 8;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // 零线
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      const y0 = yOf(0);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(width, y0);
      ctx.stroke();

      // setpoint（黄色虚线，阶跃）
      ctx.strokeStyle = "rgba(255,214,10,0.85)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < BUFFER; i++) {
        const idx = (writeIdx + i) % BUFFER;
        const x = (width * i) / (BUFFER - 1);
        const y = yOf(spBuf[idx]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // pv 渐变填充
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + usable);
      grad.addColorStop(0, "rgba(41,151,255,0.35)");
      grad.addColorStop(1, "rgba(41,151,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let i = 0; i < BUFFER; i++) {
        const idx = (writeIdx + i) % BUFFER;
        const x = (width * i) / (BUFFER - 1);
        ctx.lineTo(x, yOf(pvBuf[idx]));
      }
      ctx.lineTo(width, y0);
      ctx.closePath();
      ctx.fill();

      // pv 主线（蓝色高亮）
      ctx.strokeStyle = "#2997ff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(41,151,255,0.5)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < BUFFER; i++) {
        const idx = (writeIdx + i) % BUFFER;
        const x = (width * i) / (BUFFER - 1);
        const y = yOf(pvBuf[idx]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 当前点光标
      const lastY = yOf(pvBuf[(writeIdx + BUFFER - 1) % BUFFER]);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(width - 2, lastY, 3, 0, Math.PI * 2);
      ctx.fill();

      // 标尺标签
      ctx.fillStyle = "rgba(255,214,10,0.9)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SP ${state.sp.toFixed(1)}°`, 8, 12);
      ctx.fillStyle = "#2997ff";
      ctx.fillText(`PV ${state.pv.toFixed(1)}°`, 8, height - 6);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // 防止切后台后大步长
      if (runningRef.current) {
        acc += dt;
        const h = 1 / STEP_HZ;
        let guard = 0;
        while (acc >= h && guard < 32) {
          step(h);
          spBuf[writeIdx] = state.sp;
          pvBuf[writeIdx] = state.pv;
          writeIdx = (writeIdx + 1) % BUFFER;
          acc -= h;
          guard++;
        }
      }
      draw();
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="wave-canvas" />;
}
