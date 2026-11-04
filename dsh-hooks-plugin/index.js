/**
 * dsh-hooks — 手动执行的钩子脚本插件（真实 Cordis 插件 API）
 *
 * 钩子目录: <root>/.dsh/hooks/{pre-tool,post-tool,pre-session,post-session}/
 * 命令: /hooks list | /hooks run <pre-tool|post-tool|pre-session|post-session>
 *
 * root 的取法（2026-11-04 定）：
 *   1. config.root            显式指定，最高优先；profile 的 cordis.patch.yml 里给
 *   2. ctx.get('workspace').root   workspace 服务在的时候跟它走
 *   3. process.cwd()           兜底
 * 注意第 3 条：宿主进程的 cwd 是 profile 目录（...\.dsh\profiles\desktop），
 * 不是工作区。所以不配 config.root 的话，钩子会建到 profile 里去。
 *
 * 注意：这是「手动触发」的钩子，插件不会拦截或自动包裹任何工具调用/会话事件。
 * 仅使用 node: 内建模块，无任何第三方依赖。
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const name = 'dsh-hooks';
export const inject = ['commands'];

const PHASES = ['pre-tool', 'post-tool', 'pre-session', 'post-session'];

const USAGE = [
  '用法:',
  '  /hooks list              列出四个钩子目录里的文件',
  '  /hooks run <阶段>        依次执行该阶段目录下的 .sh / .js 文件',
  `  阶段: ${PHASES.join(' | ')}`,
  '',
  '说明: 钩子只在本命令手动触发时执行，不会自动拦截 DSH 的工具调用或会话事件。',
].join('\n');

function exists(file) {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

export function apply(ctx, config) {
  // 2026-11-04 修两处：
  // 1) 原来直接读 ctx.workspace —— 那是 cordis 的注入守卫属性，inject 里只写了
  //    ['commands']，所以每次启动都抛 `cannot get property "workspace" without inject`，
  //    整条 hooks-runner 不激活。改用 ctx.get() 绕开守卫。
  // 2) 取不到 workspace 时原来落回 process.cwd()，而宿主进程的 cwd 是 profile 目录
  //    （C:\Users\jerry\.dsh\profiles\desktop），钩子目录会跑到那儿。
  //    现在 config.root 优先，其次 workspace 服务，最后才 cwd。
  const configuredRoot =
    typeof config?.root === 'string' && config.root.trim() !== '' ? config.root.trim() : undefined;
  let workspaceRoot;
  try {
    workspaceRoot = ctx.get?.('workspace', false)?.root;
  } catch {
    workspaceRoot = undefined;
  }
  const root =
    configuredRoot ??
    (typeof workspaceRoot === 'string' && workspaceRoot !== '' ? workspaceRoot : process.cwd());
  const base = join(root, '.dsh', 'hooks');
  const dirs = {};
  for (const phase of PHASES) {
    dirs[phase] = join(base, phase);
    mkdirSync(dirs[phase], { recursive: true });
  }

  function listFiles(phase) {
    try {
      return readdirSync(dirs[phase])
        .filter((f) => exists(join(dirs[phase], f)))
        .sort();
    } catch {
      return [];
    }
  }

  function renderList() {
    const out = [`🪝 钩子目录（手动执行）: ${base}`, ''];
    let total = 0;
    for (const phase of PHASES) {
      const files = listFiles(phase);
      total += files.length;
      out.push(`[${phase}] ${files.length} 个文件`);
      if (files.length === 0) {
        out.push('  （空）');
      } else {
        for (const f of files) {
          const runner = f.endsWith('.sh') ? 'bash' : f.endsWith('.js') ? 'node' : '—';
          out.push(`  ${f}  (${runner})`);
        }
      }
      out.push('');
    }
    out.push(`合计 ${total} 个文件。`);
    return out.join('\n');
  }

  function truncate(text, max = 300) {
    const s = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (s.length === 0) return '(无输出)';
    return s.length > max ? `${s.slice(0, max)}…（共 ${s.length} 字符）` : s;
  }

  function runOne(file) {
    const isSh = file.endsWith('.sh');
    const isJs = file.endsWith('.js');
    if (!isSh && !isJs) return { skipped: true };

    const cmd = isSh ? 'bash' : process.execPath;
    const args = isSh ? [file] : [file];
    let res;
    try {
      res = spawnSync(cmd, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
      });
    } catch (err) {
      return { exit: null, error: err?.message ?? String(err) };
    }
    return {
      exit: res.status,
      signal: res.signal ?? null,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      error: res.error ? res.error.message : null,
    };
  }

  function renderRun(phase) {
    const files = listFiles(phase).filter((f) => f.endsWith('.sh') || f.endsWith('.js'));
    if (files.length === 0) {
      return {
        kind: 'success',
        text: `🪝 [${phase}] ${dirs[phase]} 里没有可执行的 .sh / .js 钩子文件。\n\n${USAGE}`,
      };
    }

    const out = [`🪝 手动执行 [${phase}] 共 ${files.length} 个钩子（cwd=${root}）`, ''];
    let failed = 0;

    for (const f of files) {
      const full = join(dirs[phase], f);
      const label = f.endsWith('.sh') ? 'bash' : 'node';
      const r = runOne(full);
      const exitText = r.exit === null || r.exit === undefined ? 'null' : String(r.exit);
      const ok = r.exit === 0;
      if (!ok) failed += 1;

      out.push(`${ok ? '✅' : '❌'} ${f}  [${label}]  exit=${exitText}${r.signal ? `  signal=${r.signal}` : ''}`);
      if (r.error) out.push(`  error: ${r.error}`);
      out.push(`  stdout: ${truncate(r.stdout)}`);
      if (r.stderr && String(r.stderr).trim()) out.push(`  stderr: ${truncate(r.stderr)}`);
      out.push('');
    }

    out.push(failed === 0 ? `全部 ${files.length} 个钩子退出码为 0。` : `${failed}/${files.length} 个钩子退出码非 0。`);
    return { kind: failed === 0 ? 'success' : 'error', text: out.join('\n') };
  }

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'hooks',
      description:
        '手动执行钩子脚本：/hooks list、/hooks run <pre-tool|post-tool|pre-session|post-session>。' +
        '仅在本命令手动触发时执行 .dsh/hooks/<阶段>/ 下的 .sh/.js，不会自动拦截工具调用或会话事件。',
      input: { hint: '[list|run] <阶段>' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim();
        const parts = raw === '' ? [] : raw.split(/\s+/);
        const sub = (parts[0] ?? 'list').toLowerCase();

        if (sub === 'list' || raw === '') {
          return { kind: 'success', text: renderList() };
        }

        if (sub === 'run' || sub === 'exec') {
          const phase = (parts[1] ?? '').toLowerCase();
          if (!phase) return { kind: 'error', text: `缺少阶段参数。\n\n${USAGE}` };
          if (!PHASES.includes(phase)) {
            return { kind: 'error', text: `未知阶段 "${phase}"。\n\n${USAGE}` };
          }
          return renderRun(phase);
        }

        return { kind: 'error', text: `未知子命令 "${sub}"。\n\n${USAGE}` };
      },
    });
    return () => dispose?.();
  });
}
