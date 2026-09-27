# 实验领域

`experimentStore` 管理跨页的 20 Hz 仿真采集、程序快照、保存与回放。采样读取常驻运行时的实际关节和底盘状态；`types` 内部统一米、弧度、秒，旧 `claw-recording` v1 在导入导出边界转换角度。

`repository.ts` 在桌面端调用 Rust 实验仓库。首次读取时从 `indexedDbRepository.ts` 分批迁入旧记录；迁移失败可重试，旧数据保留作备份。普通浏览器沿用 IndexedDB 供界面预览。Rust 将快照及分块采样写入应用数据目录，以新清单提交，不读取未完成临时文件。

`journal.ts` 串行写入，保存失败不推进采样偏移，也不丢弃内存数据。失败时停止采集并提供重试或导出；异常退出只恢复为中断记录，不恢复运动。`lastSavedRecord` 只在结束实验的最终提交成功后设置。

快照只包含关节映射、DXF 几何、路径、程序和日志，不包含 AI 配置或密钥。回放准备期间持有共享锁，阻止采集和运动；退出回放不自动续跑。针对性验证见 `tools/verification/experiments/README.md`。
