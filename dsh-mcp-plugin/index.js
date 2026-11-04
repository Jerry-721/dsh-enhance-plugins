/**
 * dsh-mcp — MCP server 配置管理
 *
 * 只使用 node: 内建模块。插件目录是指向 workspace 的 junction，Node 按真实
 * 路径解析依赖，这里没有 node_modules，任何外部 import 都会让插件加载失败，
 * 因此本插件不建立真实 MCP 连接，只做配置读写与命令可用性检查。
 *
 * 命令：/mcp list | /mcp check <name> | /mcp add <name> <command> [args...] | /mcp rm <name>
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-mcp';
export const inject = ['commands'];

const CONFIG_FILE = join(homedir(), '.dsh', 'mcp-servers.json');

const EXAMPLE = {
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  },
};

function ensureConfig() {
  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, `${JSON.stringify(EXAMPLE, null, 2)}\n`);
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`);
}

/** 判断某个可执行命令是否存在（--help，stdin/输出丢弃，只信退出码） */
function probeCommand(command) {
  const res = spawnSync(command, ['--help'], {
    stdio: 'ignore',
    timeout: 10_000,
    shell: process.platform === 'win32',
  });
  return {
    available: !res.error && res.status !== null,
    status: res.status,
    error: res.error?.code,
  };
}

export function apply(ctx) {
  ensureConfig();

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'mcp',
      description: 'MCP server 配置管理（不建立真实连接，仅校验命令可用性）',
      input: { hint: 'list | check <name> | add <name> <command> [args...] | rm <name>' },
      handler(invocation) {
        const raw = invocation.rawInput.trim();
        const parts = raw.split(/\s+/u);
        const sub = parts[0] ?? '';
        const cfg = loadConfig();

        if (sub === 'list' || sub === '') {
          const names = Object.keys(cfg);
          if (names.length === 0) {
            return { kind: 'success', text: `配置文件 ${CONFIG_FILE} 里没有 server` };
          }
          const lines = names.map((n) => {
            const s = cfg[n];
            return `- ${n}: ${s.command} ${(s.args ?? []).join(' ')}`.trimEnd();
          });
          return { kind: 'success', text: `MCP server（${names.length}）：\n${lines.join('\n')}\n配置：${CONFIG_FILE}` };
        }

        if (sub === 'check') {
          const target = parts[1];
          if (!target) return { kind: 'error', text: '用法：/mcp check <name>' };
          const server = cfg[target];
          if (!server) return { kind: 'error', text: `配置里没有「${target}」` };
          const probe = probeCommand(server.command);
          return probe.available
            ? {
                kind: 'success',
                text: `${target}: 命令 ${server.command} 可执行（--help 退出码 ${probe.status}）\n注意：这只验证命令存在，未建立 MCP 连接。`,
              }
            : {
                kind: 'error',
                text: `${target}: 命令 ${server.command} 不可执行（${probe.error ?? `退出码 ${probe.status}`}）`,
              };
        }

        if (sub === 'add') {
          const [, target, command, ...args] = parts;
          if (!target || !command) return { kind: 'error', text: '用法：/mcp add <name> <command> [args...]' };
          cfg[target] = { command, args };
          saveConfig(cfg);
          return { kind: 'success', text: `已写入 ${target}: ${command} ${args.join(' ')}`.trimEnd() };
        }

        if (sub === 'rm') {
          const target = parts[1];
          if (!target) return { kind: 'error', text: '用法：/mcp rm <name>' };
          if (!cfg[target]) return { kind: 'error', text: `配置里没有「${target}」` };
          delete cfg[target];
          saveConfig(cfg);
          return { kind: 'success', text: `已删除 ${target}` };
        }

        return { kind: 'error', text: `未知子命令「${sub}」：list / check / add / rm` };
      },
    });
    return () => dispose?.();
  });
}
