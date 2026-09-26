// 新草稿的仿真示例，既有草稿不会被替换。Created on 2026-09-27
// @author: https://github.com/Linmoqian
import type * as Blockly from "blockly/core";

export const DEFAULT_WORKSPACE: ReturnType<typeof Blockly.serialization.workspaces.save> = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: "event_start", x: 42, y: 42,
      next: { block: {
        type: "decision_if",
        inputs: {
          CONDITION: { block: { type: "sense_color", fields: { COLOR: "RED" } } },
          DO: { block: {
            type: "arm_joint_angle",
            fields: { JOINT: "0", ANGLE: 15, SPEED: 30 },
            next: { block: { type: "grab_object" } },
          } },
        },
      } },
    }],
  },
};
