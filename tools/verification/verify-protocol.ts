/**
 * M7 协议封板验证：严格 v2 envelope、SI 字段和 UI/Bridge 单位边界。
 *
 * Created on 2026-09-10
 * @author:  https://github.com/Linmoqian
 */
import assert from "node:assert/strict";
import { canTransitionCommand } from "../../app/frontend/src/core/runtime/state";
import { degreesToRadians, radiansToDegrees } from "../../app/frontend/src/robot/model";
import {
  MSG_TYPES,
  PROTOCOL_VERSION,
  ProtocolError,
  SI_UNITS,
  makeEnvelope,
  parseMessage,
  serializeMessage,
  unixSecondsToEpochMs,
} from "../../app/frontend/src/services/protocol/message";
import {
  jointsFromMessage,
  robotStateFromMessage,
} from "../../app/frontend/src/services/protocol/robot";

const envelope = makeEnvelope(
  MSG_TYPES.jointState,
  { names: ["J1", "J2"], position_rad: [Math.PI, -Math.PI / 2] },
  { frameId: "robot_base", sequence: 42, source: "protocol_test", timestamp: 1_800_000_000.25 },
);
const decoded = parseMessage(serializeMessage(envelope));
assert.equal(decoded.protocol_version, PROTOCOL_VERSION);
assert.deepEqual(decoded.units, SI_UNITS);
assert.equal(decoded.frame_id, "robot_base");
assert.equal(decoded.sequence, 42);
assert.equal(unixSecondsToEpochMs(decoded.timestamp), 1_800_000_000_250);

assert.throws(
  () => parseMessage(JSON.stringify({ version: 1, type: "joint_state", data: {} })),
  (error: unknown) => error instanceof ProtocolError && error.code === "PROTOCOL_VERSION_MISMATCH",
);
assert.throws(
  () => parseMessage(JSON.stringify({ ...envelope, units: { ...SI_UNITS, joint_position: "deg" } })),
  (error: unknown) => error instanceof ProtocolError && error.code === "PROTOCOL_INVALID_ENVELOPE",
);

const joints = jointsFromMessage({
  names: ["J1", "J2"],
  position_rad: [Math.PI, -Math.PI / 2],
});
assert.deepEqual(joints, { J1: Math.PI, J2: -Math.PI / 2 });

const robot = robotStateFromMessage({
  pose: { position_m: { x: 1, y: 2, z: 3 }, yaw_rad: Math.PI / 2 },
  twist: {
    linear_mps: { x: 0.4, y: 0, z: 0 },
    angular_radps: { x: 0, y: 0, z: 0.2 },
  },
});
assert.deepEqual(robot.pose.position, { x: 1, y: 2, z: 3 });
assert.equal(robot.velocity.linear.x, 0.4);
assert.equal(robot.velocity.angular.z, 0.2);
assert.deepEqual(robot.joints, {});

const ambiguousLegacy = robotStateFromMessage({
  pose: { x: 99 },
  joints: { J1: 40 },
} as never);
assert.deepEqual(ambiguousLegacy.pose.position, { x: 0, y: 0, z: 0 });
assert.deepEqual(ambiguousLegacy.joints, {});
assert.equal(degreesToRadians(180), Math.PI);
assert.equal(radiansToDegrees(Math.PI / 2), 90);
assert.equal(canTransitionCommand("DRAFT", "VALIDATED"), true);
assert.equal(canTransitionCommand("EXECUTING", "SUCCEEDED"), true);
assert.equal(canTransitionCommand("SUCCEEDED", "EXECUTING"), false);

console.log("[protocol] v2 SI envelope, explicit joint radians and unit boundaries verified");
