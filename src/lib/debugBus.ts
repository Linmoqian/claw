export type DebugLevel = "info" | "success" | "warning" | "error";

export type DebugMessage = {
  level: DebugLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
  timestamp: string;
};

export const DEBUG_EVENT = "claw:debug";

export function emitDebug(
  level: DebugLevel,
  scope: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  const payload: DebugMessage = {
    level,
    scope,
    message,
    detail,
    timestamp: new Date().toISOString(),
  };

  window.dispatchEvent(
    new CustomEvent<DebugMessage>(DEBUG_EVENT, { detail: payload }),
  );

  if (import.meta.env.DEV) {
    const log =
      level === "error"
        ? console.error
        : level === "warning"
          ? console.warn
          : console.info;
    log(`[Claw/${scope}] ${message}`, detail ?? "");
  }
}
