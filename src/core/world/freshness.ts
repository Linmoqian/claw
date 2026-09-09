/**
 * freshness —— 数据新鲜度（age）分级，真实数字孪生的核心安全语义。
 * 连接断开/超时后状态标 stale，而不是把旧数据当实时继续显示。
 */
export const FRESH_MS = 200;
export const STALE_MS = 1000;

export type FreshnessLevel = "fresh" | "warning" | "stale";

/** age < 200ms 正常；200~1000ms warning；> 1000ms stale */
export function freshnessOf(ageMs: number): FreshnessLevel {
  if (ageMs < FRESH_MS) return "fresh";
  if (ageMs <= STALE_MS) return "warning";
  return "stale";
}

/** 由 (最后消息时间, 当前时间) 计算 age；无数据返回 null */
export function ageMsOf(
  timestamp: number | null,
  now: number,
): number | null {
  if (timestamp === null || timestamp <= 0) return null;
  return Math.max(0, now - timestamp);
}