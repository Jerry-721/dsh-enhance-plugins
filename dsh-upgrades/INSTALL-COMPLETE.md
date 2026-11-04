# DSH 三项能力升级 - 安装完成 ✅

## 已完成

### 1. 插件安装 ✅
三个插件已通过 Junction 链接到 profile node_modules：

| 插件 | 链接目标 | 状态 |
|---|---|---|
| `dsh-skill-manifest` | `dsh-skill-plugin/` | ✅ |
| `dsh-approval` | `dsh-approval-plugin/` | ✅ |
| `dsh-mcp` | `dsh-mcp-plugin/` | ✅ |
| `@modelcontextprotocol/sdk` | 本地安装 | ✅ |

### 2. package.json 已更新 ✅
```json
{
  "dependencies": {
    // ...原有...
    "dsh-skill-manifest": "file:./dsh-skill-plugin",
    "dsh-approval": "file:./dsh-approval-plugin",
    "dsh-mcp": "file:./dsh-mcp-plugin",
    "@modelcontextprotocol/sdk": "^1.32.1"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有...
        "dsh-skill-manifest",
        "dsh-approval",
        "dsh-mcp"
      ]
    }
  }
}
```

### 3. cordis.patch.yml 已更新 ✅
```yaml
- id: mcp-servers
  name: "dsh-mcp"
  config:
    enabled: true
    servers:
      filesystem:
        command: npx
        args: ["@modelcontextprotocol/server-filesystem", "."]
```

---

## 最后一步：重启 DSH

**关闭 DSH，然后重新启动。**

重启后三个插件会自动加载：
- `skill-manifest` → 自动路由 office skills
- `approval` → 分级审批系统生效
- `mcp` → 连接 filesystem MCP server

---

## 验证方法

重启 DSH 后，在聊天中输入：

```
/test skills
```

或者直接说：
```
帮我写一个 Word 文档，标题是"测试报告"
```

应该会触发 `office-docx` skill 的自动路由。

---

## 可选：添加更多 MCP Servers

编辑 `C:\Users\jerry\.dsh\profiles\desktop\cordis.patch.yml`，在 `mcp-servers` 下添加：

```yaml
servers:
  filesystem:
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "."]
  github:
    command: npx
    args: ["@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "your-token-here"
  brave-search:
    command: npx
    args: ["@modelcontextprotocol/server-brave-search"]
    env:
      BRAVE_API_KEY: "your-key-here"
```

然后运行（需要关闭 DSH 后）：
```powershell
cd C:\Users\jerry\.dsh\profiles\desktop
node D:\dsh\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs add @modelcontextprotocol/server-github @modelcontextprotocol/server-brave-search
```

---

## 文件位置

```
C:\Users\jerry\.dsh\profiles\desktop\
├── package.json                    ← 已更新
├── cordis.patch.yml                ← 已更新
└── node_modules\
    ├── dsh-skill-manifest/         ← Junction → dsh-skill-plugin/
    ├── dsh-approval/               ← Junction → dsh-approval-plugin/
    ├── dsh-mcp/                    ← Junction → dsh-mcp-plugin/
    └── @modelcontextprotocol/      ← 本地安装
```

源码：
```
C:\Users\jerry\Documents\deepseek-harness\default-workspace\
├── dsh-skill-plugin\
├── dsh-approval-plugin\
├── dsh-mcp-plugin\
└── dsh-upgrades\
    ├── FINAL.md
    ├── INSTALL.md
    └── office-skills-manifest.json
```
