/**
 * DSH Sandbox Plugin — /sandbox
 *
 * 受 timeout 与输出长度限制的子进程执行，不是内核级沙箱隔离。
 * 只依赖 node: 内建模块，可在没有 node_modules 的 junction 目录中直接加载。
 *
 * 用法：
 *   /sandbox py <代码>    写到 <cwd>/.dsh-sandbox/script.py，用 python 执行（找不到则回退 py）
 *   /sandbox js <代码>    写到 <cwd>/.dsh-sandbox/script.mjs，用 node 执行
 *   /sandbox sh <命令>    直接执行 bash -c "<命令>"
 *   /sandbox ps <命令>    直接执行 powershell -Command "<命令>"
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-sandbox';
export const inject = ['commands'];

const TIMEOUT_MS = 60000;
const OUTPUT_LIMIT = 3000;
const MAX_BUFFER = 10 * 1024 * 1024;

const DESCRIPTION =
  '受 timeout 与输出长度限制的子进程执行，不是内核级沙箱隔离';

const USAGE = [
  '用法：',
  '  /sandbox py <代码>    执行 Python 代码（python，必要时回退 py）',
  '  /sandbox js <代码>    执行 Node.js 代码（script.mjs）',
  '  /sandbox sh <命令>    执行 bash -c',
  '  /sandbox ps <命令>    执行 powershell -Command',
  `限制：超时 ${TIMEOUT_MS}ms，stdout/stderr 各截断 ${OUTPUT_LIMIT} 字符。`,
].join('\n');

/** 截断长文本，并标记被截掉的长度 */
function clip(text, limit = OUTPUT_LIMIT) {
  const s = String(text ?? '');
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n… [已截断，另有 ${s.length - limit} 字符]`;
}

/** 把 invocation.rawInput 拆成子命令 + 剩余原文 */
function parseRaw(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  if (!m) return { sub: '', rest: '' };
  return { sub: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

function ensureSandboxDir(cwd) {
  const dir = join(cwd, '.dsh-sandbox');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 同步跑一个子进程，把结果规整成普通对象。
 * 不抛异常：spawn 失败 / 超时都体现在返回值里。
 */
function execute(command, args, cwd) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  const durationMs = Date.now() - startedAt;
  const error = result.error || null;
  const code = error && typeof error.code === 'string' ? error.code : '';

  return {
    command,
    durationMs,
    notFound: code === 'ENOENT',
    timedOut: code === 'ETIMEDOUT',
    spawnError: error && code !== 'ENOENT' && code !== 'ETIMEDOUT' ? String(error.message || error) : '',
    status: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/** 结构化结果文本 */
function formatResult(mode, target, r) {
  const lines = [];
  lines.push(`mode: ${mode}`);
  lines.push(`target: ${target}`);
  lines.push(`exit code: ${r.status === null ? 'null (killed)' : r.status}`);
  lines.push(`duration: ${r.durationMs}ms`);
  lines.push(`timeout: ${r.timedOut ? `yes (> ${TIMEOUT_MS}ms, 进程已被终止)` : `no (limit ${TIMEOUT_MS}ms)`}`);
  if (r.signal) lines.push(`signal: ${r.signal}`);
  if (r.spawnError) lines.push(`spawn error: ${r.spawnError}`);
  if (r.notFound) lines.push(`spawn error: 可执行文件未找到 (${r.command})`);
  lines.push('--- stdout ---');
  lines.push(r.stdout ? clip(r.stdout.trimEnd()) : '(empty)');
  lines.push('--- stderr ---');
  lines.push(r.stderr ? clip(r.stderr.trimEnd()) : '(empty)');
  return { text: lines.join('\n'), failed: r.timedOut || r.status !== 0 || !!r.spawnError || r.notFound };
}

function runPython(code, cwd) {
  const scriptPath = join(ensureSandboxDir(cwd), 'script.py');
  writeFileSync(scriptPath, code, 'utf8');

  let target = 'python script.py';
  let r = execute('python', [scriptPath], cwd);
  if (r.notFound) {
    // Windows 上很多机器只有 py launcher
    const fallback = execute('py', [scriptPath], cwd);
    if (!fallback.notFound) {
      r = fallback;
      target = 'py script.py (python 未找到，已回退 py)';
    } else {
      target = 'python / py (均未找到)';
    }
  }
  return formatResult('py', `${target} · ${scriptPath}`, r);
}

function runJs(code, cwd) {
  const scriptPath = join(ensureSandboxDir(cwd), 'script.mjs');
  writeFileSync(scriptPath, code, 'utf8');
  const r = execute('node', [scriptPath], cwd);
  return formatResult('js', `node script.mjs · ${scriptPath}`, r);
}

function runSh(command, cwd) {
  const r = execute('bash', ['-c', command], cwd);
  return formatResult('sh', `bash -c ${JSON.stringify(command)}`, r);
}

function runPs(command, cwd) {
  const r = execute('powershell', ['-Command', command], cwd);
  return formatResult('ps', `powershell -Command ${JSON.stringify(command)}`, r);
}

export function apply(ctx, config) {
  void config; // 本插件按固定 60000ms 超时与 3000 字符输出上限运行

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'sandbox',
      description: DESCRIPTION,
      input: { hint: '<py|js|sh|ps> <代码或命令>' },
      handler(invocation) {
        const raw = invocation?.rawInput ?? '';
        const cwd = process.cwd();
        const { sub, rest } = parseRaw(raw);

        if (!sub) return { kind: 'error', text: `缺少子命令。\n${USAGE}` };
        if (!rest) return { kind: 'error', text: `缺少${sub === 'sh' || sub === 'ps' ? '命令' : '代码'}，用法：/sandbox ${sub} <...>\n${USAGE}` };

        try {
          let result;
          switch (sub) {
            case 'py':
            case 'python':
              result = runPython(rest, cwd);
              break;
            case 'js':
            case 'node':
              result = runJs(rest, cwd);
              break;
            case 'sh':
            case 'bash':
              result = runSh(rest, cwd);
              break;
            case 'ps':
            case 'pwsh':
            case 'powershell':
              result = runPs(rest, cwd);
              break;
            default:
              return { kind: 'error', text: `未知子命令 "${sub}"。\n${USAGE}` };
          }

          return { kind: result.failed ? 'error' : 'success', text: result.text };
        } catch (error) {
          return {
            kind: 'error',
            text: `sandbox 执行失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    return () => {
      dispose?.();
    };
  });
}
