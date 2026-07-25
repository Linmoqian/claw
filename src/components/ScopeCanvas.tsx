import { useEffect, useRef } from "react";
import type { Motor, SafetyLimits } from "../types";

type Props = {
  motor: Motor;
  safety: SafetyLimits;
  show: { position: boolean; velocity: boolean; current: boolean };
};

const BUFFER = 600;

/**
 * 多通道示波器：实时采样选中电机的位置 / 速度 / 电流，滚动绘制。
 * 各通道独立 Y 轴归一化（位置归一化到关节角度区间，速度到 ±超速阈值，电流到过流阈值）。
 */
export default function ScopeCanvas({ motor, safety, show }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motorRef = useRef(motor);
  const safetyRef = useRef(safety);
  const showRef = useRef(show);
  motorRef.current = motor;
  safetyRef.current = safety;
  showRef.current = show;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const posBuf = new Float32Array(BUFFER);
    const velBuf = new Float32Array(BUFFER);
    const curBuf = new Float32Array(BUFFER);
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

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const m = motorRef.current;
      const s = safetyRef.current;
      const sh = showRef.current;

      posBuf[writeIdx] = m.angle;
      velBuf[writeIdx] = m.velocity;
      curBuf[writeIdx] = m.current;
      writeIdx = (writeIdx + 1) % BUFFER;

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const padTop = 14;
      const padBot = 16;
      const padL = 42;
      const padR = 12;
      const usableW = width - padL - padR;
      const usableH = height - padTop - padBot;

      // 网格
      ctx.strokeStyle = "rgba(80,60,30,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (usableH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
      }

      const yOf = (v: number, lo: number, hi: number) => {
        const t = (v - lo) / (hi - lo || 1);
        return padTop + usableH * (1 - Math.max(0, Math.min(1, t)));
      };

      // 位置通道填充
      if (sh.position) {
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + usableH);
        grad.addColorStop(0, "rgba(176,67,42,0.16)");
        grad.addColorStop(1, "rgba(176,67,42,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(padL, padTop + usableH);
        for (let i = 0; i < BUFFER; i++) {
          const idx = (writeIdx + i) % BUFFER;
          const x = padL + (usableW * i) / (BUFFER - 1);
          ctx.lineTo(x, yOf(posBuf[idx], m.min, m.max));
        }
        ctx.lineTo(width - padR, padTop + usableH);
        ctx.closePath();
        ctx.fill();
      }

      const stroke = (buf: Float32Array, lo: number, hi: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < BUFFER; i++) {
          const idx = (writeIdx + i) % BUFFER;
          const x = padL + (usableW * i) / (BUFFER - 1);
          const y = yOf(buf[idx], lo, hi);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      if (sh.position) stroke(posBuf, m.min, m.max, "#b0432a");
      if (sh.velocity) stroke(velBuf, -s.velocityMax, s.velocityMax, "#3d5a5a");
      if (sh.current) stroke(curBuf, 0, s.currentMax, "#b08035");

      // Y 轴标签（位置通道刻度）
      ctx.fillStyle = "#847449";
      ctx.font = "10px 'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${m.max.toFixed(0)}°`, padL - 5, padTop + 9);
      ctx.fillText(`${m.min.toFixed(0)}°`, padL - 5, padTop + usableH);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="scope-canvas" />;
}
