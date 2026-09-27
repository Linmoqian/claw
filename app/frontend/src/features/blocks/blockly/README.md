# 积木领域

`blocks.ts` 与 `toolbox.ts` 定义编辑器；`programAst.ts` 从冻结工作区生成桌面执行树；`desktopProgram.ts` 负责 Rust Channel 和取消；`desktopGateway.ts` 将动作请求交给设备网关。`interpreter.ts` 是浏览器预览解释器，`vision/` 保存合成视觉与 PnP。位姿和动作在边界明确转换单位。
