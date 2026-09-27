# 本地实验记录

`experimentStore` 管理跨页的 20 Hz 仿真采集、程序快照、保存与回放。采样读取常驻运行时的实际关节和底盘状态，不驱动运动；TCP 使用机械臂基座坐标。`types` 内部统一米、弧度、秒，导出带版本的 `claw-experiment` JSON。

`repository` 使用独立的原生 IndexedDB `xiakao-experiments`，每秒在同一事务提交元信息、场景/程序快照及采样分块。`journal` 串行写入，事务成功后才推进采样偏移和已提交元信息，列表不与活动记录共享可变引用。失败停止采集并保留内存全部数据，可重试或导出；结束时最后一次事务成功后才释放实验锁。保存中及保存失败期间通过 `recordingSuspended` 禁止再次启动运动。异常退出恢复标记为中断，缺失范围取决于最后一次成功提交时间；后台限速或存储延迟可能扩大未提交区间，不恢复运动。

`lastSavedRecord` 只在结束实验的最终事务成功后设置，供工作台展示“已保存”和结果入口；中断会话重试保存成功也会设置此字段。开始新实验时清空，可通过 `dismissSaveNotice()` 主动关闭提示。该反馈保留在当前会话内，不从历史数据库恢复。

旧数据集 localStorage 键不迁移、不覆盖；旧 `claw-recording` v1 的角度制通过 `sampling.toLegacyFrames` 与回放桥边界转换。实验快照只包含关节映射、DXF 几何和路径、执行程序与日志，不包含 AI 配置、密钥、连接地址或个人文件路径。

回放准备从读取 IndexedDB 前开始持有共享 `replayPreparing` 锁，直到机型、运行时和回放桥就绪或失败才释放。程序、采集、机型、串口和数据桥的普通入口拒绝准备期间的新操作；内部恢复机型/回放桥传入 `replayPreparation` 标记，避免准备流程锁住自己。失败后不自动恢复运动。

针对性验证见 `tools/verification/experiments/README.md`。浏览器关闭前需完成保存，导出文件可作为备份。
