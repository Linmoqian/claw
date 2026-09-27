# 页面会话验证

`integration/` 存放共享会话的集成验证。使用内存中的替身 AI client，不访问模型、网络、密钥或硬件。

运行：`pnpm dlx tsx tools/verification/sessions/integration/verify-sessions.ts`。tsx 仅临时运行，不加入项目依赖。

脚本不生成文件，不需要额外环境变量或忽略规则。
