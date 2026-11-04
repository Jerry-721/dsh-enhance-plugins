# DSH 增强插件集

一套面向 **DeepSeek Harness（DSH）** 的本地增强插件，共 9 个。

思路很直接：把 Claude Code、ChatGPT Canvas、Codex CLI 这些工具里好用的能力，
按 DSH 自己的插件模型（Cordis）重新实现一遍，做成 `/命令` 挂进聊天窗口。

**先说清楚边界**：这 9 个都是「命令 + 本地状态文件」形态的插件，
**不接管 DSH 内核**——不拦截工具调用、不改写审批流程、不注入 system prompt。
它们提供的是可查询、可操作的本地能力，决策权仍在你和内核手里。
装进 profile 就能用，不需要改 DSH 源码。

---

## 功能一览

| 插件 | 包名 | 命令 | 实际行为 |
|---|---|---|---|
| 技能清单 | `dsh-skill-manifest` | `/skills` | 读 `office-skills-manifest.json`，按触发词给出技能匹配建议（打分：命中词总长 + 命中数）。只给建议，不改变模型行为 |
| 分级审批 | `dsh-approval` | `/approve` | 策略存 `~/.dsh/approval-policy.json`，按 `deny → confirm → autoAllow` 判定一段命令文本。只做判定，不接管内核审批 |
| MCP 配置 | `dsh-mcp` | `/mcp` | 读写 `~/.dsh/mcp-servers.json`，用 `--help` 探测命令是否可执行。**不建立真实 MCP 连接** |
| 持久记忆 | `dsh-memory` | `/memory` `/mem` `/memo` | 全局 `~/.dsh/memory.md` + 项目 `<cwd>/.dsh/memory/workspace.md` 的增删查。工具自行读取，不会自动注入 |
| 钩子脚本 | `dsh-hooks` | `/hooks` | 列出并**手动**执行 `.dsh/hooks/{pre-tool,post-tool,pre-session,post-session}/` 下的 `.sh` / `.js` |
| 自动模式 | `dsh-auto-mode` | `/auto` | 开关状态存 `~/.dsh/auto-mode.json`；用内置正则判定命令属于「拦截 / 需确认 / 放行」。只是标记与判定 |
| 任务循环 | `dsh-agentic-loop` | `/loop` | 按关键词选模板生成 4 步计划，写 `.dsh/agentic-loop.json`，用 `next` 推进。**不调 LLM、不自动执行** |
| 代码沙箱 | `dsh-sandbox` | `/sandbox` | 以子进程执行 py / js / sh / ps，60s 超时、stdout/stderr 各截断 3000 字符。**不是内核级隔离** |
| 画布 | `dsh-canvas` | `/canvas` | 工作区内 `.md/.txt/.html` 的 open / save / preview / list；preview 用极简正则把 Markdown 转 HTML |

### 各插件子命令

```text
/skills  list | match <原话> | show <技能名>

/approve list | check <命令文本>
         deny <正则> | allow <正则> | reset

/mcp     list | check <name> | add <name> <command> [args...] | rm <name>

/memory  [list] | add <文本> | gadd <文本> | search <词> | rm <序号>
         （/mem、/memo 为同一实现的别名）

/hooks   list | run <pre-tool|post-tool|pre-session|post-session>

/auto    [状态] | on | off | check <命令文本>

/loop    plan <目标> | status | next | abort

/sandbox py <代码> | js <代码> | sh <命令> | ps <命令>

/canvas  open <相对路径> | save <相对路径> <内容> | preview <相对路径> | list
```

---

## 技术栈

- **运行时**：Node.js（ESM），插件以 `export const name / inject / apply(ctx, config)` 形式导出
- **插件框架**：Cordis —— DSH 的插件内核，通过 `ctx.commands.register()` 注册命令、`ctx.effect()` 管理生命周期
- **配置注入**：每个插件带一份 `cordis.patch.yml`，以 YAML patch 形式插入 profile 的 loader 层
- **依赖策略**：**只用 `node:` 内建模块**。插件目录通常以 junction 方式挂进 workspace，
  Node 按真实路径解析依赖，那里没有 `node_modules`，任何 `@deepseek-ai/*` 或第三方 import 都会解析失败
- **包管理**：pnpm / npm，以 `file:` 协议从本地路径安装

---

## 运行方法

### 环境要求

- 已安装 DeepSeek Harness，能定位当前使用的 profile 目录（如 `~/.dsh/profiles/desktop`）
- Node.js ≥ 20（本项目在 Node 24 上验证）

### 1. 取源码

```bash
git clone <本仓库地址> dsh-plugins
```

### 2. 在 profile 里登记依赖

编辑 profile 的 `package.json`，在 `dependencies` 中加入 9 个本地包（路径换成你自己的绝对路径）：

```json
{
  "dependencies": {
    "dsh-skill-manifest": "file:<绝对路径>/dsh-skill-plugin",
    "dsh-approval":       "file:<绝对路径>/dsh-approval-plugin",
    "dsh-mcp":            "file:<绝对路径>/dsh-mcp-plugin",
    "dsh-memory":         "file:<绝对路径>/dsh-memory-plugin",
    "dsh-hooks":          "file:<绝对路径>/dsh-hooks-plugin",
    "dsh-auto-mode":      "file:<绝对路径>/dsh-auto-mode-plugin",
    "dsh-agentic-loop":   "file:<绝对路径>/dsh-agentic-loop-plugin",
    "dsh-sandbox":        "file:<绝对路径>/dsh-sandbox-plugin",
    "dsh-canvas":         "file:<绝对路径>/dsh-canvas-plugin"
  }
}
```

### 3. 挂进 bundles

同一个 `package.json` 的 `dsh.profile.bundles` 数组末尾追加：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-skill-manifest",
        "dsh-approval",
        "dsh-mcp",
        "dsh-memory",
        "dsh-hooks",
        "dsh-auto-mode",
        "dsh-agentic-loop",
        "dsh-sandbox",
        "dsh-canvas"
      ]
    }
  }
}
```

### 4. 安装并重启

```bash
cd <profile 目录>
pnpm install     # 或 npm install
```

重启 DSH。在输入框敲 `/`，应能看到 `skills`、`approve`、`mcp`、`memory`、`hooks`、`auto`、`loop`、`sandbox`、`canvas`。

### 5. 自检

`dsh-upgrades/` 下带了两套检查脚本：

```bash
node dsh-upgrades/verify-plugins.mjs   # 静态检查：包名 / 补丁格式 / 外部 import / 语法 / profile 完整性
node dsh-upgrades/smoke-plugins.mjs    # 用假 ctx 实际调用 apply() 与 handler，贴近真实加载
```

`dsh-agentic-loop` 另有单元测试：

```bash
cd dsh-agentic-loop-plugin && npm test
```

---

## 项目结构

```text
.
├── README.md                     本文件
├── 项目说明.txt                   项目用途与主要功能（纯文本速览）
├── .gitignore                    只放行插件源码与配套文档
├── .gitattributes                统一 LF 换行
│
├── dsh-skill-plugin/             技能清单（dsh-skill-manifest）
│   ├── index.js
│   ├── manifest.json             结构化 skill 元数据：trigger / toolDeps / composite
│   └── cordis.patch.yml
├── dsh-approval-plugin/          分级审批（dsh-approval）
│   ├── index.js
│   └── utils.js                  glob / 花括号模式匹配
├── dsh-mcp-plugin/               MCP 配置（dsh-mcp）
├── dsh-memory-plugin/            持久记忆（dsh-memory）
├── dsh-hooks-plugin/             钩子脚本（dsh-hooks）
├── dsh-auto-mode-plugin/         自动模式（dsh-auto-mode）
├── dsh-agentic-loop-plugin/      任务循环（dsh-agentic-loop）
│   └── test/agentic-loop.test.js
├── dsh-sandbox-plugin/           代码沙箱（dsh-sandbox）
├── dsh-canvas-plugin/            画布（dsh-canvas）
│
├── dsh-upgrades/                 配套文档与自检脚本
│   ├── PLUGIN-MANIFEST.md        插件清单（A 组可直接装 / B 组需取源码）
│   ├── REPORT.md                 完整踩坑记录与根因分析
│   ├── verify-plugins.mjs        静态检查
│   ├── smoke-plugins.mjs         加载冒烟测试
│   ├── office-skills-manifest.json   /skills 读取的清单
│   ├── profile-backup/           profile 被重置时的一键还原素材
│   └── *-design.md               审批 / MCP / Skills 三份方案设计（设计稿，非现状）
└── dsh-super-upgrades/           能力对标分析与移植计划（设计稿，非现状）
```

每个插件目录形态一致：

```text
dsh-xxx-plugin/
├── index.js             插件实现（export name / inject / apply）
├── package.json         包名、type: module、dsh.bundle.patch 指向
└── cordis.patch.yml     patch 层，声明 id / 默认 config
```

---

## 两条必须遵守的硬规则

踩过坑，写在这里提醒后来者（详见 [`dsh-upgrades/REPORT.md`](dsh-upgrades/REPORT.md)）：

**1. `inject` 必须先声明**

Cordis 里任何 service（`commands`、`workspace`、`tools`…）都要先写进 `export const inject = ['commands']`，
才能通过 `ctx.xxx` 访问。否则一读就抛
`Error: cannot get property "workspace" without inject`，
而**整个 `apply` 会静默失败、命令注册不上**——表现就是"敲了没反应"，很难查。

`dsh-hooks` 是后来的做法：改用 `ctx.get('workspace', false)` 绕开注入守卫，
并加一层 `config.root` → `workspace.root` → `process.cwd()` 的兜底顺序
（宿主进程的 cwd 是 profile 目录，不是工作区，直接落 cwd 会把文件建错地方）。

**2. 只用 `node:` 内建模块**

插件目录是指向 workspace 的 junction，Node 按真实路径解析依赖，那里没有 `node_modules`。
任何 `@deepseek-ai/*` 或第三方 import 都会让插件加载失败。
（`dsh-mcp-plugin/package.json` 里虽然留了 `@modelcontextprotocol/sdk` 依赖，但 `index.js` 并未使用。）

---

## 相关文档

- [`dsh-upgrades/PLUGIN-MANIFEST.md`](dsh-upgrades/PLUGIN-MANIFEST.md) —— 插件清单与安装分类
- [`dsh-upgrades/REPORT.md`](dsh-upgrades/REPORT.md) —— 自检报告、踩坑记录、根因分析
- [`dsh-upgrades/approval-system-design.md`](dsh-upgrades/approval-system-design.md) —— 四级审批架构（设计稿）
- [`dsh-upgrades/mcp-integration-design.md`](dsh-upgrades/mcp-integration-design.md) —— MCP 连接管理与 Schema 转译（设计稿）
- [`dsh-upgrades/skills-manifest-design.md`](dsh-upgrades/skills-manifest-design.md) —— Skills 结构化方案（设计稿）
- [`dsh-super-upgrades/README.md`](dsh-super-upgrades/README.md) —— 与 Claude Code / ChatGPT / Codex CLI / Grok 的能力对标

---

## 许可

MIT
