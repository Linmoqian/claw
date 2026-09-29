import { useEffect, useRef } from "react";
import type { Motor, TuneParams } from "../../../core/motors";

type Props = {
  motor: Motor;
  tune: TuneParams;
  running: boolean;
};

const BUFFER = 480; // 采样点数
const STEP_HZ = 120; // 仿真步频
const PERIOD_MS = 3000; // 阶跃周期

/**
 * Canvas 实时波形 + 仿真。
 * 被控对象：积分环节 + 轻微阻尼。支持 PID + 高级参数（前馈/滤波/限幅/斜坡/死区）。
 */
export default function WaveCanvas({ motor, tune, running }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tuneRef = useRef(tune);
  const motorRef = useRef(motor);
  const runningRef = useRef(running);

  tuneRef.current = tune;
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
      spRamped: 0,
      prevSp: 0,
      pv: 0,
      integral: 0,
      lastErr: 0,
      dFilt: 0,
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
      const t = tuneRef.current;
      const { kp, ki, kd, kv, kg, dFilterHz, pvSmooth, outLimit, iLimit, rampRate, deadZone } = t;

      // 周期阶跃目标
      phaseTimer += dt;
      const rawTarget = phaseTimer % (PERIOD_MS / 1000) < PERIOD_MS / 2000 ? amp() : -amp();

      // 目标斜坡：设定点限速跟随
      const maxStep = rampRate * dt;
      const d = rawTarget - state.spRamped;
      state.spRamped += Math.max(-maxStep, Math.min(maxStep, d));
      state.sp = state.spRamped;

      // 速度前馈（目标每步位移）
      const targetVel = state.sp - state.prevSp;
      state.prevSp = state.sp;

      // 误差 + 死区
      let err = state.sp - state.pv;
      if (Math.abs(err) < deadZone) err = 0;

      // 积分 + 积分限幅（抗饱和）
      state.integral += err * dt;
      state.integral = Math.max(-iLimit, Math.min(iLimit, state.integral));

      // 微分 + 一阶低通滤波
      const rawD = (err - state.lastErr) / dt;
      const coef = Math.max(0, Math.min(1, 2 * Math.PI * dFilterHz * dt));
      state.dFilt += (rawD - state.dFilt) * coef;
      state.lastErr = err;

      // 输出 = PID + 前馈，再输出限幅
      let output = kp * err + ki * state.integral + kd * state.dFilt + kv * targetVel + kg * state.sp;
      output = Math.max(-outLimit, Math.min(outLimit, output));

      // 被控对象：积分环节 + 阻尼 + 反馈(PV)平滑
      const pvNext = (state.pv + output * dt * 0.06) * 0.998;
      state.pv += (pvNext - state.pv) * (1 - pvSmooth);
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

      // 网格：暖墨细格，如纸纹
      ctx.strokeStyle = "rgba(80,60,30,0.05)";
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

      // 零线：墨色基线
      ctx.strokeStyle = "rgba(80,60,30,0.10)";
      const y0 = yOf(0);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(width, y0);
      ctx.stroke();

      // setpoint（黛青墨虚线，阶跃）
      ctx.strokeStyle = "rgba(61,90,90,0.85)";
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

      // pv 朱砂墨晕填充
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + usable);
      grad.addColorStop(0, "rgba(176,67,42,0.18)");
      grad.addColorStop(1, "rgba(176,67,42,0)");
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

      // pv 主线（朱砂墨笔 + 晕染）
      ctx.strokeStyle = "#b0432a";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(176,67,42,0.28)";
      ctx.shadowBlur = 9;
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

      // 当前点光标：纸白 + 朱砂环
      const lastY = yOf(pvBuf[(writeIdx + BUFFER - 1) % BUFFER]);
      ctx.fillStyle = "#fdf6ea";
      ctx.strokeStyle = "#b0432a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(width - 2, lastY, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 标尺标签：墨色批注
      ctx.fillStyle = "#847449";
      ctx.font = "11px 'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SP ${state.sp.toFixed(1)}°`, 8, 12);
      ctx.fillStyle = "#b0432a";
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
