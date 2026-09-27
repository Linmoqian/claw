# 验证脚本

从仓库根目录执行 `pnpm dlx tsx tools/verification/verify-protocol.ts` 等脚本。`lint.mjs` 由 `pnpm --dir app run lint` 调用，同时检查 `app/` 和 `tools/`。

`transport/verify.ts` 验证桌面传输可能返回的异步发送错误会传递给控制调用方。
