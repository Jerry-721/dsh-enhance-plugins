# DSH 插件清单（已实测可用）

> 整理日期：2026-10-25
> 供转发他人参照安装。分 A / B 两组：A 组可直接装，B 组为本地手写插件需取源码。

## ⚠️ 两条硬规则（B 组尤其重要）

1. **Cordis 的 `inject` 规则**：任何 service（`workspace`、`tools`、`command`…）都必须先在
   `export const inject = ['commands']` 里声明，才能通过 `ctx.xxx` 访问；否则
   `ctx.workspace` 一读就抛 `Error: cannot get property "workspace" without inject`，
   整个插件的 apply 会静默失败、命令注册不上。
2. **只用 `node:` 内建模块**：本地插件目录是指向 workspace 的 junction，Node 按真实路径
   解析依赖，那里没有 node_modules。**不要 import 任何 `@deepseek-ai/*` 或第三方包**，
   否则依赖解析必失败。

---

## A 组：可直接安装（npm / registry / market）

| 插件 | 版本 | 用途 |
|---|---|---|
| `dshmarket` | ^1.66.42 | 插件市场本体 |
| `@deepseek-ai/dsh-base` | *内置* | 基础底座 |
| `@deepseek-ai/dsh-web-app` | *内置* | Web 界面 |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | *实验* | Agent 团队（实验） |
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | *实验* | 语音输入（实验） |
| `@deepseek-ai/dsh-experimental-auto-review` | *实验* | 自动复查（实验） |
| `@tt-a1i/archify-dsh` | 1.0.0 | 架构图 / 图表 |
| `@linxin666/dsh-web-all` | 0.4.8 | Web 增强全家桶 |
| `@liustack/modlens` | 3.27.1 | 视觉读取 / OCR 桥 |
| `dsh-better-sidebar` | 0.28.0 | 侧边栏增强 |
| `@deepseek-harness-tui/dsh-tui` | 0.16.1 | 终端 TUI |
| `@nanmicoder/dsh-agent-teams` | 0.1.25 | Agent 团队 |
| `dsh-context` | 0.73.3 | 上下文管理 |
| `dsh-open-design` | *custom* | OpenDesign 模板引擎 |
| `misakanet` | 2.48.0 | MisakaNet 教训库 |
| `dsh-ops` | 0.4.1 | 运维工具 |
| `dsh-our-free-model` | 2.5.6 (GitHub) | 免费模型路由 |
| `dsh-remote-plugin` | 0.8.0-rc.8 | DSH Remote 远程/移动端 |
| `dsh-windows-computer-use` | 0.1.0-preview.3 | Windows 桌面操控 |
| `@dsh-user/dsh-wxauto` | *file* | 微信自动化（wxauto） |

---

## B 组：本地手写增强插件（需取源码）

这些 `file:` 指向 workspace 目录，命令级功能，需要把当前工作区 `dsh-upgrades/`
里的源码一并带走。

| 插件包名 | 命令 | 用途 |
|---|---|---|
| `dsh-skill-manifest` | `/skills` | 技能清单管理 |
| `dsh-approval` | `/approve` | 审批策略判定 |
| `dsh-mcp` | `/mcp` | MCP server 配置与检查 |
| `dsh-memory` | `/memory` `/mem` `/memo` | 全局 + 项目持久化记忆 |
| `dsh-hooks` | `/hooks` | pre/post 钩子执行 |
| `dsh-auto-mode` | `/auto` | 自动模式与危险命令判定 |
| `dsh-agentic-loop` | `/loop` | 任务分解与进度跟踪 |
| `dsh-sandbox` | `/sandbox` | Python / Node / Bash / PowerShell 子进程执行 |
| `dsh-canvas` | `/canvas` | 文件 + Markdown 预览 |

---

## 配套自检脚本（位于 `dsh-upgrades/`）

| 脚本 | 作用 |
|---|---|
| `verify-plugins.mjs` | 静态检查：包名 / 补丁格式 / 外部 import / 语法 / profile 完整性 |
| `smoke-plugins.mjs` | 用假 `ctx` 实际调用 `apply()` 与 handler，贴近真实加载 |
| `restore-profile.ps1` + `profile-backup/` | profile 被 DSH 重置时一键还原 bundles 与 patch |
| `REPORT.md` | 完整踩坑记录（含 inject 规则根因） |