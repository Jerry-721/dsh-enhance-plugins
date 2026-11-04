/**
 * DSH MCP 集成 - 核心实现
 * 
 * 参考 Codex 的 mcp_tool.rs 和 mcp_discovery.rs
 */

import { Client, Tool as McpTool, ListToolsResult } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Context, Service } from '@deepseek-ai/cordis';
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ==================== 类型定义 ====================

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  transport?: 'stdio' | 'sse';
  url?: string;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface DshToolSpec {
  name: string;
  description: string;
  inputSchema: any;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    openWorldHint?: boolean;
  };
}

// ==================== 连接管理器 ====================

export class McpConnectionManager extends EventEmitter {
  private connections = new Map<string, Client>();
  private processes = new Map<string, ChildProcess>();
  private maxRetries = 3;
  private retryDelay = 1000;

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
      transport = new SSEClientTransport(new URL(config.url));
    } else {
      const stdioConfig: StdioServerParameters = {
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env },
        cwd: config.cwd
      };
      transport = new StdioClientTransport(stdioConfig);
    }

    try {
      await client.connect(transport);
      this.connections.set(name, client);
      
      // 监听连接事件
      client.onclose = () => {
        this.connections.delete(name);
        this.emit('disconnected', name);
      };
      
      client.onerror = (error) => {
        this.emit('error', name, error);
      };

      return client;
    } catch (error) {
      throw new Error(`Failed to connect to MCP server '${name}': ${error}`);
    }
  }

  async disconnect(name: string): Promise<void> {
    const client = this.connections.get(name);
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.warn(`Error disconnecting MCP server ${name}:`, error);
      }
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

  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  is Connected(name: string): boolean {
    return this.connections.has(name);
  }
}

// ==================== Schema 转译器 ====================

export class McpToolTranslator {
  /**
   * 将 MCP tool schema 转换为 DSH tool spec
   * 参考 Codex tools/src/mcp_tool.rs
   */
  static translate(serverName: string, mcpTool: McpTool): DshToolSpec {
    return {
      name: `${serverName}:${mcpTool.name}`,
      description: mcpTool.description,
      inputSchema: this.translateJsonSchema(mcpTool.inputSchema),
      annotations: {
        title: `${serverName} - ${mcpTool.name}`,
        readOnlyHint: this.isReadOnly(mcpTool.inputSchema),
        openWorldHint: !this.isDeterministic(mcpTool.inputSchema)
      }
    };
  }

  private static translateJsonSchema(schema: any): any {
    // 处理 MCP 特有类型
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    // 复制并处理 schema
    const translated = { ...schema };
    
    // 移除 MCP 特有的字段
    delete translated.$schema;
    delete translated.$id;
    
    // 递归处理 properties
    if (translated.properties) {
      translated.properties = Object.fromEntries(
        Object.entries(translated.properties).map(([key, value]) => [
          key,
          this.translateJsonSchema(value)
        ])
      );
    }

    return translated;
  }

  private static isReadOnly(schema: any): boolean {
    // 根据 inputSchema 判断是否为只读操作
    if (!schema?.properties) return false;
    
    const props = Object.keys(schema.properties);
    const writeIndicators = ['write', 'create', 'update', 'delete', 'modify', 'execute'];
    
    return !props.some(p => writeIndicators.some(w => p.toLowerCase().includes(w)));
  }

  private static isDeterministic(schema: any): boolean {
    // 判断操作是否确定性（无随机性）
    if (!schema?.properties) return true;
    
    const props = Object.keys(schema.properties);
    const nonDeterministic = ['query', 'search', 'list', 'get', 'read'];
    
    return !props.some(p => nonDeterministic.some(n => p.toLowerCase().includes(n)));
  }
}

// ==================== 工具注册器 ====================

export class McpToolRegistry {
  private manager: McpConnectionManager;
  private context: Context;
  private registeredTools = new Map<string, DshToolSpec>();

  constructor(manager: McpConnectionManager, ctx: Context) {
    this.manager = manager;
    this.context = ctx;
  }

  async registerAll(config: McpConfig): Promise<void> {
    const registerPromises = Object.entries(config.servers).map(
      async ([name, serverConfig]) => this.registerServer(name, serverConfig)
    );
    
    await Promise.all(registerPromises);
  }

  private async registerServer(name: string, config: McpServerConfig): Promise<void> {
    try {
      const client = await this.manager.connect(name, config);
      
      // 列出 server 提供的 tools
      const toolsResult: ListToolsResult = await client.listTools();
      
      for (const tool of toolsResult.tools) {
        const dshTool = McpToolTranslator.translate(name, tool);
        this.registeredTools.set(dshTool.name, dshTool);
        
        // 注册到 context
        this.context.provide(`mcp:${name}:${tool.name}`, async (args: any) => {
          return this.callTool(name, tool.name, args);
        });
      }
      
      this.context.logger('mcp').info(
        `Registered ${toolsResult.tools.length} tools from MCP server '${name}'`
      );
    } catch (error) {
      this.context.logger('mcp').warn(
        `Failed to register MCP server '${name}': ${error}`
      );
    }
  }

  private async callTool(
    serverName: string,
    toolName: string, 
    args: any
  ): Promise<any> {
    const client = this.manager.connections.get(serverName);
    if (!client) {
      throw new Error(`MCP client not connected for server: ${serverName}`);
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args
      });
      
      return result;
    } catch (error) {
      this.context.logger('mcp').error(
        `Error calling ${serverName}:${toolName}: ${error}`
      );
      throw error;
    }
  }

  getRegisteredTools(): DshToolSpec[] {
    return Array.from(this.registeredTools.values());
  }

  hasTool(toolName: string): boolean {
    return this.registeredTools.has(toolName);
  }
}

// ==================== 插件集成 ====================

export function installMcpPlugin(ctx: Context) {
  const connectionManager = new McpConnectionManager();
  const toolRegistry = new McpToolRegistry(connectionManager, ctx);
  
  // 提供到 context
  ctx.provide('mcpConnectionManager', connectionManager);
  ctx.provide('mcpToolRegistry', toolRegistry);
  
  // 监听配置更新
  ctx.on('config/reload', async () => {
    const mcpConfig = ctx.get('mcpConfig') as McpConfig | undefined;
    if (!mcpConfig) return;
    
    // 清理旧连接
    await connectionManager.disconnectAll();
    toolRegistry['registeredTools'].clear();
    
    // 重新注册
    await toolRegistry.registerAll(mcpConfig);
  });
  
  // 清理
  ctx.effect(() => () => {
    connectionManager.disconnectAll();
  });
  
  return { connectionManager, toolRegistry };
}

// ==================== 配置解析器 ====================

export function parseMcpConfig(patchYaml: any[]): McpConfig | null {
  const mcpEntry = patchYaml.find((entry: any) => entry.id === 'mcp-servers');
  if (!mcpEntry) return null;
  
  return {
    servers: mcpEntry.config?.servers || {}
  };
}

export function validateMcpConfig(config: McpConfig): string[] {
  const errors: string[] = [];
  
  for (const [name, server] of Object.entries(config.servers)) {
    if (!server.command) {
      errors.push(`MCP server '${name}' missing 'command'`);
    }
    
    if (server.transport === 'sse' && !server.url) {
      errors.push(`MCP server '${name}' with SSE transport requires 'url'`);
    }
  }
  
  return errors;
}

// ==================== 导出 ====================

export { McpConnectionManager, McpToolTranslator, McpToolRegistry };
