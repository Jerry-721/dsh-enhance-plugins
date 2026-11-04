/**
 * dsh-memory — 持久化记忆插件（真实 Cordis 插件 API）
 *
 * 全局记忆: ~/.dsh/memory/global.md
 * 项目记忆: <cwd>/.dsh/memory/workspace.md
 *
 * 命令: /memory [list] | add <文本> | gadd <文本> | search <词> | rm <序号>
 * 仅使用 node: 内建模块，无任何第三方依赖。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-memory';
export const inject = ['commands'];

const GLOBAL_HEADER = '# 全局记忆（~/.dsh/memory/global.md）\n# 行格式: - [YYYY-MM-DD] 文本\n';
const WORKSPACE_HEADER = '# 项目记忆（<cwd>/.dsh/memory/workspace.md）\n# 行格式: - [YYYY-MM-DD] 文本\n';

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ensureFile(file, header) {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, header, 'utf8');
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

/** 收集文件里的条目（以 "- " 开头的行），保留 1 起始的真实行号 */
function collectEntries(file) {
  const lines = readLines(file);
  const entries = [];
  lines.forEach((line, i) => {
    if (/^\s*-\s+/.test(line)) {
      entries.push({ lineNo: i + 1, text: line.trim() });
    }
  });
  return entries;
}

function appendEntry(file, header, text) {
  ensureFile(file, header);
  let content = readFileSync(file, 'utf8');
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  content += `- [${today()}] ${text}\n`;
  writeFileSync(file, content, 'utf8');
}

const USAGE = [
  '用法:',
  '  /memory            列出两处记忆',
  '  /memory add <文本>   写入项目记忆',
  '  /memory gadd <文本>  写入全局记忆',
  '  /memory search <词>  大小写不敏感搜索',
  '  /memory rm <序号>    删除项目记忆第 N 条',
].join('\n');

/**
 * 选一个可写的全局记忆文件。
 *
 * 这台机器上 ~/.dsh 允许往目录里写文件，但不允许新建子目录
 * （mkdir ~/.dsh/memory 会被拒 EPERM）。所以直接用 ~/.dsh/memory.md，
 * 只有它能建出来时才用更规整的 ~/.dsh/memory/global.md。
 */
function pickGlobalFile() {
  const flat = join(homedir(), '.dsh', 'memory.md');
  const nested = join(homedir(), '.dsh', 'memory', 'global.md');
  try {
    mkdirSync(dirname(flat), { recursive: true });
    return flat;
  } catch {
    return nested;
  }
}

export function apply(ctx, config) {
  // 注意：Cordis 里未在 inject 中声明的 service 一旦读取就会抛异常
  // （cannot get property "workspace" without inject）。所以这里用 try 兜住，
  // 引擎不提供 workspace 服务时退回进程 cwd。
  let root = process.cwd();
  try {
    const ws = ctx.workspace;
    if (ws && typeof ws.root === 'string' && ws.root !== '') root = ws.root;
  } catch {
    /* 没有 workspace 服务时用 cwd */
  }

  const globalFile = pickGlobalFile();
  const workspaceFile = join(root, '.dsh', 'memory', 'workspace.md');

  // apply 时建好文件；写失败不拖垮插件加载（例如 ~/.dsh 下建不出子目录）
  try {
    ensureFile(globalFile, GLOBAL_HEADER);
  } catch {
    /* 全局记忆不可写时只影响那一半 */
  }
  try {
    ensureFile(workspaceFile, WORKSPACE_HEADER);
  } catch {
    /* 项目记忆不可写时只影响那一半 */
  }

  function renderList() {
    const g = collectEntries(globalFile);
    const w = collectEntries(workspaceFile);
    const out = ['📋 记忆列表', '', `[全局] ${globalFile} — ${g.length} 条`];
    if (g.length === 0) {
      out.push('  （空）');
    } else {
      g.forEach((e, i) => out.push(`  ${i + 1}. L${e.lineNo}  ${e.text}`));
    }
    out.push('', `[项目] ${workspaceFile} — ${w.length} 条`);
    if (w.length === 0) {
      out.push('  （空）');
    } else {
      w.forEach((e, i) => out.push(`  ${i + 1}. L${e.lineNo}  ${e.text}`));
    }
    return out.join('\n');
  }

  function renderSearch(query) {
    const q = query.toLowerCase();
    const hits = [];
    for (const [label, file] of [['全局', globalFile], ['项目', workspaceFile]]) {
      for (const e of collectEntries(file)) {
        if (e.text.toLowerCase().includes(q)) {
          hits.push(`  [${label}] L${e.lineNo}  ${e.text}`);
        }
      }
    }
    if (hits.length === 0) {
      return { kind: 'success', text: `🔍 未找到匹配 "${query}" 的记忆条目（已搜索全局与项目记忆）` };
    }
    return {
      kind: 'success',
      text: `🔍 匹配 "${query}"（${hits.length} 条）\n${hits.join('\n')}`,
    };
  }

  function removeEntry(index) {
    const entries = collectEntries(workspaceFile);
    if (entries.length === 0) {
      return { kind: 'error', text: '项目记忆为空，没有可删除的条目。' };
    }
    const target = entries[index - 1];
    if (!target) {
      return { kind: 'error', text: `序号超出范围：项目记忆共 ${entries.length} 条（1-${entries.length}）。` };
    }
    const lines = readLines(workspaceFile);
    lines.splice(target.lineNo - 1, 1);
    writeFileSync(workspaceFile, lines.join('\n'), 'utf8');
    return {
      kind: 'success',
      text: `🗑 已删除项目记忆第 ${index} 条（原 L${target.lineNo}）\n  ${target.text}`,
    };
  }

  ctx.effect(() => {
    let dispose;
    try {
      const entry = {
      description: '持久化记忆：/mem add|gadd|list|search|rm（全局 ~/.dsh/memory.md，项目 <cwd>/.dsh/memory/workspace.md）',
      input: { hint: '[add|gadd|search|rm] <参数>' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim();
        if (raw === '') return { kind: 'success', text: renderList() };

        const m = raw.match(/^(\S+)\s*([\s\S]*)$/);
        const sub = m[1].toLowerCase();
        const rest = m[2].trim();

        if (sub === 'list') return { kind: 'success', text: renderList() };

        if (sub === 'add') {
          if (!rest) return { kind: 'error', text: `用法: /memory add <文本>\n\n${USAGE}` };
          appendEntry(workspaceFile, WORKSPACE_HEADER, rest);
          return {
            kind: 'success',
            text: `✅ 已写入项目记忆\n  - [${today()}] ${rest}\n  文件: ${workspaceFile}`,
          };
        }

        if (sub === 'gadd') {
          if (!rest) return { kind: 'error', text: `用法: /memory gadd <文本>\n\n${USAGE}` };
          appendEntry(globalFile, GLOBAL_HEADER, rest);
          return {
            kind: 'success',
            text: `✅ 已写入全局记忆\n  - [${today()}] ${rest}\n  文件: ${globalFile}`,
          };
        }

        if (sub === 'search') {
          if (!rest) return { kind: 'error', text: `用法: /memory search <词>\n\n${USAGE}` };
          return renderSearch(rest);
        }

        if (sub === 'rm' || sub === 'remove' || sub === 'del') {
          if (!rest) return { kind: 'error', text: `用法: /memory rm <序号>\n\n${USAGE}` };
          const n = Number.parseInt(rest, 10);
          if (!Number.isInteger(n) || n < 1) {
            return { kind: 'error', text: `无效序号 "${rest}"，请输入从 1 开始的整数。` };
          }
          return removeEntry(n);
        }

        return { kind: 'error', text: `未知子命令 "${sub}"。\n\n${USAGE}` };
      },
      };

      // 多名字注册：某个名字被内核占用时其余仍能挂上
      dispose = [];
      for (const cmdName of ['memory', 'mem', 'memo']) {
        try {
          dispose.push(ctx.commands.register({ ...entry, name: cmdName }));
        } catch {
          /* 该名字不可用，跳过 */
        }
      }
    } catch {
      return () => {};
    }
    return () => {
      for (const d of dispose ?? []) d?.();
    };
  });
}
