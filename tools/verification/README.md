# 验证脚本

从仓库根目录执行 `pnpm dlx tsx tools/verification/verify-protocol.ts` 等脚本。`lint.mjs` 由 `pnpm --dir app run lint` 调用，同时检查 `app/` 和 `tools/`。
