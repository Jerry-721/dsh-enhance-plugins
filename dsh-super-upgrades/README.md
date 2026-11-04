# DSH 超级增强 - 全球顶级 AI agent 长处移植计划

## 对标分析

| 能力 | Claude Code | ChatGPT | Codex CLI | Grok | **DSH 移植方案** |
|---|---|---|---|---|---|
| 项目记忆 | .claude/CLAUDE.md | GPTs custom instructions | skills/ | Deep Search | ✅ `.dsh/memory/` 系统 |
| Prompt 缓存 | 原生支持 | - | - | - | ✅ Agnes API caching |
| Auto Mode | 全自动执行 | Canvas 协作 | auto-approval | - | ✅ `dsh-auto-mode` 插件 |
| Hooks 系统 | pre/post tool hooks | - | - | - | ✅ `dsh-hooks` 插件 |
| 多文件编辑 | atomic multi-file | Code Interpreter | multi-edit | - | ✅ 已有（read/edit/write） |
| Sub-agents | 64+ subagents | - | 结构化 skill | - | ✅ 已有 AgentTeams |
| MCP 集成 | 一等公民 | Plugin system | 一等公民 | API | ✅ `dsh-mcp` 已安装 |
| 分级审批 | 四级审批 | - | 审批系统 | - | ✅ `dsh-approval` 已安装 |

## 本次新增移植

### 1. 🧠 Memory 系统（移植自 Claude Code .claude/）
- `~/.dsh/memory/` 全局记忆目录
- 每个 workspace 的 `.dsh/memory/` 项目记忆
- 自动注入到每个 session 的 system prompt

### 2. ⚡ Auto Mode（移植自 Claude Code auto mode）
- 所有低风险操作自动批准
- 危险操作仍确认
- 一键开关

### 3. 🔗 Hooks 系统（移植自 Claude Code hooks）
- `pre-tool` / `post-tool` 钩子
- `pre-session` / `post-session` 钩子
- 支持 shell 脚本和 JS 钩子

### 4. 💰 Prompt Caching（移植自 Claude prompt caching）
- 利用 Agnes API 的 prompt caching 特性
- 自动复用系统 prompt 减少费用

---

## 快速验证

重启 DSH 后在聊天中输入：
- `/memory add "项目使用 python-docx 创建 Word 文档"`
- `/memory list` 查看已存储的记忆
- `/auto on` 开启自动模式
