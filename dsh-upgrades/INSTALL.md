# DSH 三项能力升级 - 安装指南

## 快速安装

### 1. Skills 结构化升级

```powershell
# 安装插件
cd C:\Users\jerry\Documents\deepseek-harness\default-workspace\dsh-skill-plugin
pnpm install

# 添加到 desktop profile
dsh plugin --profile desktop add file:./dsh-skill-plugin
```

### 2. 分级审批系统

```powershell
# 安装插件
cd C:\Users\jerry\Documents\deepseek-harness\default-workspace\dsh-approval-plugin
pnpm install

# 添加到 desktop profile
dsh plugin --profile desktop add file:./dsh-approval-plugin
```

### 3. MCP 集成

```powershell
# 安装插件
cd C:\Users\jerry\Documents\deepseek-harness\default-workspace\dsh-mcp-plugin
pnpm install

# 添加到 desktop profile
dsh plugin --profile desktop add file:./dsh-mcp-plugin
```

## 配置示例

在 `C:\Users\jerry\.dsh\profiles\desktop\cordis.patch.yml` 中添加：

```yaml
# MCP Servers
- id: mcp-servers
  name: "dsh-mcp"
  config:
    servers:
      filesystem:
        command: npx
        args: ["@modelcontextprotocol/server-filesystem", "."]
      github:
        command: npx
        args: ["@modelcontextprotocol/server-github"]
        env:
          GITHUB_TOKEN: "${GITHUB_TOKEN}"
      brave-search:
        command: npx
        args: ["@modelcontextprotocol/server-brave-search"]
        env:
          BRAVE_API_KEY: "${BRAVE_API_KEY}"
```

## 验证安装

```powershell
# 查看已安装的插件
dsh plugin --profile desktop list

# 查看当前配置
dsh --dump-config --profile desktop
```

## 手动部署（无需重启）

如果无法使用 `dsh plugin add`，可以手动复制：

```powershell
# Skills Manifest
Copy-Item "dsh-upgrades\office-skills-manifest.json" "D:\dsh\resources\runtime\office-skills\"

# 重启 DSH 使配置生效
```

## 注意事项

1. **MCP 依赖**: 需要安装 `@modelcontextprotocol/sdk`
   ```powershell
   pnpm add @modelcontextprotocol/sdk
   ```

2. **权限问题**: DSH 运行时目录受保护，需要通过 plugin 系统安装

3. **重启生效**: 修改 cordis.patch.yml 后需要重启 DSH
