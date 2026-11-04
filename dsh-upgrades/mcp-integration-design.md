# DSH MCP 集成架构设计

## 现状分析

当前 DSH 的 MCP 支持：
- npm 包 `@modelcontextprotocol/client` 已存在于 `node_modules`
- 但**零调用**，完全没有集成
- 配置系统 (`cordis.patch.yml`) 中没有 MCP server 配置入口

**Codex 参考**：
- `codex-rs/tools/src/mcp_tool.rs` - MCP → Responses API 转译层
- `codex-rs/tools/src/mcp_discovery.rs` - MCP server 自动发现
- `codex-rs/app-server-protocol/` - JSON-RPC 协议支持

## 设计方案

### 1. 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    DSH Profile                          │
│  cordis.patch.yml                                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │ mcpServers:                                      │   │
│  │   github:                                        │   │
│  │     command: npx                                │   │
│  │     args: ["@modelcontextprotocol/server-github"]│   │
│  │   filesystem:                                    │   │
│  │     command: npx                                │   │
│  │     args: ["@modelcontextprotocol/server-filesystem", "/workspace"]│
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Integration Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Server       │  │ Connection   │  │ Tool         │  │
│  │ Discovery    │  │ Manager      │  │ Translator   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Stdio        │  │ SSE          │  │ Tool         │  │
│  │ Handler      │  │ Handler      │  │ Registry     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Cordis Plugin System                    │
│  - Register MCP tools as DSH tools                      │
│  - Handle tool calls through existing pipeline          │
│  - Support tool result formatting                       │
└─────────────────────────────────────────────────────────┘
```

### 2. 配置解析

```typescript
// mcp-config.ts
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  transport?: 'stdio' | 'sse';
  url?: string; // for SSE
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

// 从 cordis.patch.yml 解析
function parseMcpConfig(patchYaml: any): McpConfig | null {
  const mcpEntry = patchYaml.find((entry: any) => entry.id === 'mcp-servers');
  if (!mcpEntry) return null;
  
  return {
    servers: mcpEntry.config?.servers || {}
  };
}
```

### 3. Server 连接管理

```typescript
// mcp-connection.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export class McpConnectionManager {
  private connections = new Map<string, Client>();
  private processes = new Map<string, ChildProcess>();
  
  async connect(name: string, config: McpServerConfig): Promise<Client> {
    if (this.connections.has(name)) {
      return this.connections.get(name)!;
    }
    
    const client = new Client(
      { name: 'dsh', version: '0.2.1' },
      { capabilities: {} }
    );
    
    let transport;
    if (config.transport === 'sse' || config.url) {
      transport = new SSEClientTransport(new URL(config.url!));
    } else {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env }
      });
    }
    
    await client.connect(transport);
    this.connections.set(name, client);
    
    // 清理
    client.onclose = () => {
      this.connections.delete(name);
    };
    
    return client;
  }
  
  async disconnect(name: string): Promise<void> {
    const client = this.connections.get(name);
    if (client) {
      await client.close();
      this.connections.delete(name);
    }
  }
  
  async disconnectAll(): Promise<void> {
    const promises = [];
    for (const name of this.connections.keys()) {
      promises.push(this.disconnect(name));
    }
    await Promise.all(promises);
  }
}
```

### 4. Tool Schema 转译

```typescript
// mcp-tool-translator.ts
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { ToolSpec } from '@deepseek-ai/dsh-api-gateway';

/**
 * 将 MCP tool schema 转换为 DSH tool spec
 * 参考 Codex 的 mcp_tool.rs
 */
export function translateMcpTool(
  serverName: string,
  mcpTool: McpTool
): ToolSpec {
  return {
    name: `${serverName}:${mcpTool.name}`,
    description: mcpTool.description,
    inputSchema: translateJsonSchema(mcpTool.inputSchema),
    annotations: {
      title: `${serverName} - ${mcpTool.name}`,
      readOnlyHint: isReadOnly(mcpTool.inputSchema),
      openWorldHint: !isDeterministic(mcpTool.inputSchema)
    }
  };
}

function translateJsonSchema(schema: any): any {
  // 简化处理：直接透传 JSON Schema
  // 实际项目中需要处理 MCP 特有类型
  return schema;
}

function isReadOnly(schema: any): boolean {
  // 根据 inputSchema 判断是否为只读操作
  return schema?.properties?.path ? true : false;
}

function isDeterministic(schema: any): boolean {
  // 判断操作是否确定性
  return !schema?.properties?.command;
}
```

### 5. Tool 注册到 Agent

```typescript
// mcp-tool-registry.ts
import { Context } from '@deepseek-ai/cordis';
import { McpConnectionManager } from './mcp-connection.js';
import { translateMcpTool } from './mcp-tool-translator.js';

export function installMcpToolRegistry(ctx: Context) {
  const connectionManager = new McpConnectionManager();
  
  // 注册到 ctx
  ctx.provide('mcpConnections', connectionManager);
  
  // 监听 tool call
  ctx.on('agent/prepare-tools', async (event, next) => {
    const mcpConfig = ctx.get('mcpConfig');
    if (!mcpConfig) return next();
    
    const extraTools = [];
    
    for (const [name, config] of Object.entries(mcpConfig.servers)) {
      try {
        const client = await connectionManager.connect(name, config);
        
        // 列出 server 提供的 tools
        const tools = await client.listTools();
        
        for (const tool of tools.tools) {
          const dshTool = translateMcpTool(name, tool);
          extraTools.push(dshTool);
        }
      } catch (error) {
        ctx.logger('mcp').warn(`Failed to connect to MCP server ${name}:`, error);
      }
    }
    
    // 将 MCP tools 注入到 tool set
    event.tools.push(...extraTools);
    return next();
  });
  
  // 处理 MCP tool call
  ctx.on('agent/tool-call', async (event, next) => {
    if (!event.toolName.startsWith(':')) return next();
    
    const [serverName, toolName] = event.toolName.split(':');
    const client = connectionManager.connections.get(serverName);
    if (!client) return next();
    
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: event.args
      });
      
      event.result = result;
      return next();
    } catch (error) {
      event.error = error;
      return next();
    }
  });
  
  // 清理
  ctx.effect(() => () => {
    connectionManager.disconnectAll();
  });
}
```

### 6. 典型配置示例

```yaml
# cordis.patch.yml
- id: mcp-servers
  name: "@deepseek-ai/dsh-mcp-integration"
  config:
    servers:
      github:
        command: npx
        args: ["@modelcontextprotocol/server-github"]
        env:
          GITHUB_TOKEN: "${GITHUB_TOKEN}"
      filesystem:
        command: npx
        args: ["@modelcontextprotocol/server-filesystem", "."]
      brave-search:
        command: npx
        args: ["@modelcontextprotocol/server-brave-search"]
        env:
          BRAVE_API_KEY: "${BRAVE_API_KEY}"
      puppeteer:
        command: npx
        args: ["@modelcontextprotocol/server-puppeteer"]
```

### 7. 错误处理与重试

```typescript
// mcp-retry.ts
export class McpRetryStrategy {
  private maxRetries = 3;
  private baseDelay = 1000; // ms
  
  async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === this.maxRetries - 1) throw error;
        
        const delay = this.baseDelay * Math.pow(2, i);
        console.warn(`MCP operation '${context}' failed, retry ${i+1}/${this.maxRetries} in ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Unexpected');
  }
}
```

### 8. 实施步骤

1. **Phase 1**: 创建 `mcp-config.ts` - 配置解析
2. **Phase 2**: 创建 `mcp-connection.ts` - 连接管理
3. **Phase 3**: 创建 `mcp-tool-translator.ts` - Schema 转译
4. **Phase 4**: 创建 `mcp-tool-registry.ts` - Tool 注册
5. **Phase 5**: 创建 `mcp-retry.ts` - 错误处理
6. **Phase 6**: 集成到 `dsh-app-boot.js` 的 plugin 系统
7. **Phase 7**: 添加 GUI 配置界面

## 与现有代码的集成点

- `dsh-app-boot.js:553` - Cordis Context 导入点
- `dsh-app-boot.js:875` - Plugin loading
- `desktop-main.js:1377` - API gateway 集成点

## 安全考虑

1. **Sandboxing**: MCP server 进程应在受限环境中运行
2. **Token 隔离**: 各 server 的 credentials 隔离存储
3. **Network 限制**: 限制 MCP server 的网络访问
4. **Filesystem 限制**: 通过 args 限制可访问路径
