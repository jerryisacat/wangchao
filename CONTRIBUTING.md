# 贡献指南

感谢你考虑为望潮（Wangchao）贡献！这是一个 MIT 开源项目，欢迎社区参与。

## 如何贡献

### 提交 Bug 报告或功能建议

通过 GitHub Issues 提交。请尽量包含：

- 复现步骤（如果是 bug）
- 期望行为和实际行为
- 相关主题、信源或环境变量（不要贴真实密钥）
- 日志或错误信息

### 提交 Pull Request

1. Fork 这个仓库
2. 从 `main` 创建特性分支：`git checkout -b feat/your-feature`
3. 确保通过最低验证：

   ```bash
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```

4. 如果涉及数据库 schema 变更，必须包含 Prisma migration 和 `CODEGUIDE.md` 更新
5. 如果涉及环境变量，必须同步 `.env_example` 和 `CODEGUIDE.md`
6. Commit message 使用中文格式 `类型:修改内容`（参见 `AGENTS.md` 第 6 节）
7. 提交 PR 并描述变更原因、实际改动和验证结果

### 用 AI Agent 定制

这个项目特别欢迎用 AI Agent（Claude Code、Cursor、Copilot 等）做 fork 定制。如果你想为某个垂直领域（半导体、政策、开源生态等）改造这个仓库：

1. Fork 仓库
2. 把 `AGENTS.md` 和 `CODEGUIDE.md` 喂给你的 coding agent
3. 让 agent 按你的领域、信源、偏好规则和部署环境改造
4. 如果改动对上游有价值（bug 修复、通用适配器、文档改进），欢迎提 PR 回馈

## 开发规范

- 技术栈和架构以 `REFACTOR_PLAN.md` 为准
- 代码结构和数据流以 `CODEGUIDE.md` 为准
- AI Agent 协作规则以 `AGENTS.md` 为准
- 抓取、AI、简报、导出等长任务必须放在 worker，不放进 request lifecycle
- LLM 输出一律视为不可信输入，后端 sanitize，前端安全渲染
- 不提交 `.env`、密钥、token、`data/*`、生成数据

## 行为准则

保持友善、尊重、建设性。这是个人维护的开源项目，响应可能不即时，但所有善意贡献都会被认真对待。

## License

提交的贡献将基于 [MIT License](LICENSE) 授权。
