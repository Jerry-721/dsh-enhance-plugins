# DSH 插件自检与修复报告

## 零、最终结论（2026-10-20 22:2x）

九个插件**全部在真机上加载并可用**，用户已确认 `/mem` 出现并可用。

踩到的最后一个坑值得记下来，因为它是 Cordis 的硬规则：

```js
// 错误：ctx.workspace 是未在 inject 中声明的 service，一读就抛
const root = ctx?.workspace?.root ?? process.cwd();
// Error: cannot get property "workspace" without inject
```

**Cordis 里任何 service（`commands`、`workspace`、`tools`…）都必须先在 `export const inject`
里声明，才能通过 `ctx.xxx` 访问，否则抛异常并让整个插件的 apply 失败。**
memory 是九个插件里唯一读 `workspace` 的，所以只有它静默挂掉——探针能写成功（在抛异常之前），
`ctx.commands.register` 一次都没跑到，表现就是"菜单里没有这个命令"。

修法是 try 兜住并退回 `process.cwd()`，不必强行 inject：

```js
let root = process.cwd();
try {
  const ws = ctx.workspace;
  if (ws && typeof ws.root === 'string' && ws.root !== '') root = ws.root;
} catch {
  /* 没有 workspace 服务就用 cwd */
}
```

最终形态：`inject = ['commands']`，命令注册在 `ctx.effect` 内，只用 `node:` 内建模块。

## 一、这次自检发现了什么（重要）

上一轮"11 项能力已移植"的结论**不成立**，实测有三处硬伤：

| 问题 | 证据 | 后果 |
|---|---|---|
| 插件用臆造的 API | 9 个 index.js 里全是 `ctx.provide` / `ctx.on('command/xxx')`；真实 Cordis API 是 `export const inject` + `ctx.commands.register` | 插件从未加载。`~/.dsh/memory/`、`~/.dsh/mcp-servers.json` 全都不存在 |
| 两个 404 依赖 | `@deepseek-ai/dsh-subagent-claude-code`、`@deepseek-ai/dsh-subagent-codex` 写进了 `dependencies: latest`，npm 上不存在 | 触发 DSH 的 profile 恢复流程 |
| 恢复流程抹掉配置 | 重启后 `dsh.profile.bundles` 从 25 变成 2（只剩 base + web-app），`cordis.patch.yml` 只剩 4 项 | 一轮内丢失：agnes provider（`llm-pi-ai`）、better-sidebar、pet、market 开关；模型被换成 deepseek-flash |

恢复后的 bundles 与 patch 已按 `.dsh-market/snapshots/snapshot-2026-10-20T09-13-38-912Z.json`（09:13 的市场快照）逐项还原，并额外保留了 `misakanet`。

## 二、现在修好了什么

### 1. 插件全部按真实 API 重写

统一形态（只用 `node:` 内建模块，不 import 任何 `@deepseek-ai/*`——插件目录是指向 workspace 的 junction，Node 按真实路径解析依赖，那里没有 node_modules，外部 import 必然失败）：

```js
export const name = 'dsh-xxx';
export const inject = ['commands'];
export function apply(ctx, config) {
  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'xxx',
      description: '……',
      input: { hint: '<子命令>' },
      handler(invocation) { return { kind: 'success', text: '...' }; },
    });
    return () => dispose?.();
  });
}
```

bundle 补丁改用 loader 认可的 `insert` 形态：

```yaml
- insert:
    - id: memory-store
      name: 'dsh-memory'
      config:
        enabled: true
```

### 2. 九个插件与命令

| 插件包名 | 命令 | 实际能力 |
|---|---|---|
| `dsh-memory` | `/memory` add·gadd·list·search·rm | 读写 `~/.dsh/memory/global.md` 与 `<cwd>/.dsh/memory/workspace.md` |
| `dsh-hooks` | `/hooks` list·run | 手动执行 `<cwd>/.dsh/hooks/{pre,post}-{tool,session}/` 下的 sh/js 钩子 |
| `dsh-auto-mode` | `/auto` on·off·check | 开关状态文件 + 危险命令模式判定 |
| `dsh-sandbox` | `/sandbox` py·js·sh·ps | 子进程执行，timeout 60s，输出截断 3000 字符 |
| `dsh-canvas` | `/canvas` open·save·preview·list | 文件读写 + 极简 Markdown→HTML 预览 |
| `dsh-agentic-loop` | `/loop` plan·status·next·abort | 本地任务分解与进度跟踪（不自动执行步骤） |
| `dsh-skill-manifest` | `/office` | 技能清单与触发词匹配建议 |
| `dsh-approval` | `/approve` list·check·deny·allow·reset | 策略判定（不接管内核审批） |
| `dsh-mcp` | `/mcp` list·check·add·rm | MCP server 配置管理；**不建立真实 MCP 连接**，只校验命令可用性 |

### 3. 静态自检脚本

```powershell
node dsh-upgrades\verify-plugins.mjs
```

校验 9 个插件的：包名一致性、`type: module`、`dsh.bundle.patch`、补丁 YAML 形态、是否残留外部 import、是否残留臆造 API、`node --check` 语法、profile 层的 bundles/dependencies/junction，以及 patch 是否仍保留 agnes provider 等条目。当前结果：**全部通过**。

## 三、必须说明的边界

这些插件现在是**斜杠命令级**的辅助功能，不是内核级集成：

- `/auto`、`/approve` 不做拦截——真正的审批仍由 DSH 内核的 approval 策略决定
- `/mcp` 不连 MCP server——受 junction 依赖解析限制，插件无法 import MCP SDK
- `/hooks` 不自动触发——Cordis 没有暴露 pre/post tool-call 事件给这类插件
- `/loop` 不驱动模型执行——只是把计划写进 `.dsh/agentic-loop.json`

要真正做到"拦截 / 连接 / 自动触发"，得改 DSH 内核或在 profile 里以真实 npm 包（而非 junction）安装插件，属于另一件事。

## 四、生效方式

1. 关闭 DSH，重新打开（host 插件只在启动时加载）
2. 打开后自检：
   ```powershell
   node dsh-upgrades\verify-plugins.mjs        # 应输出"全部通过"
   Test-Path ~\.dsh\memory\global.md            # 应为 True（说明 memory 插件真的跑起来了）
   Test-Path ~\.dsh\mcp-servers.json            # 应为 True
   ```
3. 在聊天里试 `/memory list`、`/mcp list`、`/canvas list`

## 五、回滚

若重启后 profile 又被重置（bundles 变回 2），关闭 DSH 后执行：

```powershell
powershell -ExecutionPolicy Bypass -File dsh-upgrades\restore-profile.ps1
```

备份位：`dsh-upgrades/profile-backup/{package.json,cordis.patch.yml}`（bundles=25，含 agnes provider / pet / better-sidebar / market 配置）。

## 六、没能做到的事

- `@deepseek-ai/dsh-subagent-claude-code`、`@deepseek-ai/dsh-subagent-codex`：npm 公开源 404，需要内网 registry 与鉴权，已从 dependencies 移除以免再次触发恢复流程。
- 沙盒内的真实子进程验证：本会话的 Windows 文件沙箱禁止 piped stdio（`spawnSync EPERM`），`/sandbox` 的真实执行只能在 DSH 宿主进程里复验。
