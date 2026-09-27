// 冻结程序并建立与编辑器独立的执行工作区。Created on 2026-09-27
// @author: https://github.com/Linmoqian
import * as Blockly from "blockly";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseProgramSnapshot(raw: string): ReturnType<typeof Blockly.serialization.workspaces.save> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed))
    throw new Error("草稿格式损坏");
  // Blockly 会忽略未知序列化器和 null 数据，随后保存为 {}；提前拒绝以保留原文。
  // 真正的空对象是合法空工作区，变量或注释独立存在也无需 blocks 字段。
  const serializers = Blockly.registry.getAllItems(Blockly.registry.Type.SERIALIZER, true) ?? {};
  if (Object.keys(parsed).some((key) => !Object.prototype.hasOwnProperty.call(serializers, key)))
    throw new Error("草稿包含无法识别的数据");
  if (Object.prototype.hasOwnProperty.call(parsed, "blocks")) {
    const blocks = parsed.blocks;
    if (!isRecord(blocks) || !Array.isArray(blocks.blocks)
      || Object.keys(blocks).some((key) => key !== "blocks" && key !== "languageVersion")
      || (Object.prototype.hasOwnProperty.call(blocks, "languageVersion")
        && (!Number.isInteger(blocks.languageVersion) || Number(blocks.languageVersion) < 0))
      || blocks.blocks.some((block: unknown) => !isRecord(block) || typeof block.type !== "string" || !block.type))
      throw new Error("草稿积木数据损坏");
  }
  for (const key of ["variables", "workspaceComments"])
    if (Object.prototype.hasOwnProperty.call(parsed, key) && !Array.isArray(parsed[key]))
      throw new Error("草稿辅助数据损坏");
  return parsed as ReturnType<typeof Blockly.serialization.workspaces.save>;
}

export function createProgramSnapshot(source: Blockly.Workspace): {
  snapshot: ReturnType<typeof Blockly.serialization.workspaces.save>;
  workspace: Blockly.Workspace;
} {
  const snapshot = structuredClone(Blockly.serialization.workspaces.save(source));
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(snapshot, workspace);
    return { snapshot, workspace };
  } catch (error: unknown) {
    workspace.dispose();
    throw error;
  }
}
