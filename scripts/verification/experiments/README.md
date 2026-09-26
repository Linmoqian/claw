# 实验记录验证

在仓库根目录执行 `pnpm dlx tsx scripts/verification/experiments/verify.ts`（若本地已有 tsx，也可使用 `pnpm exec tsx`）。不进行构建，不连接硬件。

脚本验证实际仿真状态采样及 SI 单位、旧录像 90 度首帧/插值/末帧、损坏文件拒绝、保存失败后完整重试和并发增量写入顺序。浏览器验收另外覆盖 IndexedDB 持久化、异常退出恢复、跨页持续采集和回放门禁；脚本不代替浏览器及桌面硬件验证。
