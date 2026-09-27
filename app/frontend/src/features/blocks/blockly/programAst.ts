// 冻结 Blockly 工作区的跨语言执行树。Created on 2026-09-28
// @author:  https://github.com/Linmoqian
import type * as Blockly from "blockly/core";

export interface ProgramNode {
  type: string;
  enabled: boolean;
  fields: Record<string, string>;
  inputNames: string[];
  inputs: Record<string, ProgramNode>;
  next?: ProgramNode;
  procedure?: { name: string; args: string[]; hasReturn: boolean };
}

export interface ProgramAst {
  version: 1;
  top: ProgramNode[];
}

type ProcedureBlock = Blockly.Block & {
  getProcedureDef?: () => [string, string[], boolean];
  arguments_?: string[];
};

function serializeBlock(block: Blockly.Block, count: { value: number }, depth: number): ProgramNode {
  if (++count.value > 5000 || depth > 256)
    throw new Error("程序积木数量或嵌套深度超出桌面执行限制");
  const fields: Record<string, string> = {};
  const inputNames: string[] = [];
  const inputs: Record<string, ProgramNode> = {};
  for (const input of block.inputList) {
    if (input.name) inputNames.push(input.name);
    for (const field of input.fieldRow) {
      if (field.name) fields[field.name] = String(block.getFieldValue(field.name) ?? "");
    }
    const target = input.connection?.targetBlock();
    if (target && input.name) inputs[input.name] = serializeBlock(target, count, depth + 1);
  }
  const node: ProgramNode = { type: block.type, enabled: block.isEnabled(), fields, inputNames, inputs };
  const procedure = (block as ProcedureBlock).getProcedureDef?.();
  if (procedure) node.procedure = {
    name: procedure[0],
    args: (block as ProcedureBlock).arguments_ ?? procedure[1],
    hasReturn: procedure[2],
  };
  const next = block.getNextBlock();
  if (next) node.next = serializeBlock(next, count, depth + 1);
  return node;
}

export function createProgramAst(workspace: Blockly.Workspace): ProgramAst {
  const count = { value: 0 };
  return { version: 1, top: workspace.getTopBlocks(false).map((block) => serializeBlock(block, count, 0)) };
}
