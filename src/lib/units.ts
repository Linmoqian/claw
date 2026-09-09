/**
 * 舵机原始位置（0-4095）与角度（°）之间的换算。
 *
 * 零点与运动范围取自 `claw_arm/skills/nature_arm/references/so100_calibration.md`
 * 的实测校准数据（每关节不同）。量程沿用 STS3215 标称 270° / 分辨率 4095。
 */

/** STS3215 标称量程（°） */
export const SERVO_RANGE_DEG = 270;
/** 舵机位置原始值上限 */
export const SERVO_MAX_POSITION = 4095;

/** 每关节实测校准：零点 raw、可达 raw 范围。键为硬件舵机 ID（1-6）。 */
export const CALIB: Record<number, { zero: number; min: number; max: number }> = {
  1: { zero: 2078, min: 721, max: 3489 }, // shoulder_pan
  2: { zero: 930, min: 919, max: 3301 }, // shoulder_lift
  3: { zero: 3008, min: 777, max: 3013 }, // elbow_flex
  4: { zero: 1198, min: 870, max: 3206 }, // wrist_flex
  5: { zero: 3321, min: 0, max: 4095 }, // wrist_roll
  6: { zero: 1461, min: 1271, max: 2783 }, // gripper
};

/** 原始位置 → 角度（°），零点取该关节实测校准值 */
export function positionToAngle(pos: number, hwId: number): number {
  const c = CALIB[hwId];
  if (!c) return 0;
  return (pos - c.zero) * (SERVO_RANGE_DEG / SERVO_MAX_POSITION);
}

/** 角度（°）→ 原始位置，钳到该关节实测可达范围（保护机械结构） */
export function angleToPosition(angle: number, hwId: number): number {
  const c = CALIB[hwId];
  if (!c) return 0;
  const raw = c.zero + (angle / SERVO_RANGE_DEG) * SERVO_MAX_POSITION;
  return Math.max(c.min, Math.min(c.max, Math.round(raw)));
}
