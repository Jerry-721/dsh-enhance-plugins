/**
 * dsh-auto-mode — 自动模式开关 + 危险命令判定（真实 Cordis 插件 API）
 *
 * 状态文件: ~/.dsh/auto-mode.json  →  { enabled: boolean, updatedAt: string }
 * 命令: /auto | /auto on | /auto off | /auto check <命令文本>
 *
 * 重要：本插件只提供「开关」与「判定」，不接管 DSH 内核的审批流程 ——
 * 它不会拦截、自动批准或改写任何真实的工具调用。
 * 仅使用 node: 内建模块，无任何第三方依赖。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-auto-mode';
export const inject = ['commands'];

const STATE_FILE = join(homedir(), '.dsh', 'auto-mode.json');

/** 会被拦截：明显不可撤销 / 破坏性极高的命令 */
const DENY_PATTERNS = [
  { re: /\brm\s+-[a-z]*[rf][a-z]*[rf][a-z]*\s+\/(?:\s|$)/i, label: 'rm -rf /' },
  { re: /\brm\s+-[a-z]*[rf][a-z]*\s+\/(?:\s|$)/i, label: 'rm -r /' },
  { re: /\bsudo\s+rm\b/i, label: 'sudo rm' },
  { re: /\bmkfs(?:\.\w+)?\b/i, label: 'mkfs' },
  { re: /\bdd\b[^|;&]*(?:of=)?\/dev\//i, label: 'dd /dev/' },
  { re: /(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/i, label: 'curl|sh' },
  { re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i, label: 'chmod -R 777 /' },
  { re: /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, label: 'fork bomb' },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b/i, label: '关机/重启' },
];

/** 需确认：破坏性可控但影响面较大 */
const CONFIRM_PATTERNS = [
  { re: /\bsudo\b/i, label: 'sudo 提权' },
  { re: /\bgit\s+push\b[^|;&]*(?:--force|-f)\b/i, label: 'git push --force' },
  { re: /\bgit\s+reset\s+--hard\b/i, label: 'git reset --hard' },
  { re: /\brm\s+-[a-z]*r/i, label: '递归删除' },
  { re: /\bnpm\s+(?:install|i)\s+(?:-g\b|--global\b)/i, label: 'npm 全局安装' },
  { re: /\bpip\s+install\s+-U\b/i, label: 'pip 升级安装' },
  { re: /\b(?:npm|pnpm|yarn)\s+publish\b/i, label: '发布包' },
  { re: /\bchmod\s+-R\b/i, label: '递归改权限' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function nowIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`;
}

function defaultState() {
  return { enabled: false, updatedAt: '' };
}

function loadState() {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return {
      enabled: parsed?.enabled === true,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function judge(command) {
  const text = String(command ?? '').trim();
  if (!text) return { verdict: '需确认', reason: '命令为空，无法判定' };
  for (const p of DENY_PATTERNS) {
    if (p.re.test(text)) return { verdict: '该命令会被拦截', reason: `命中危险模式：${p.label}` };
  }
  for (const p of CONFIRM_PATTERNS) {
    if (p.re.test(text)) return { verdict: '需确认', reason: `命中需确认模式：${p.label}` };
  }
  return { verdict: '自动放行', reason: '未命中内置危险/需确认模式' };
}

const USAGE = [
  '用法:',
  '  /auto                显示当前状态',
  '  /auto on             标记为开启',
  '  /auto off            标记为关闭',
  '  /auto check <命令>   按内置危险模式判定该命令的 verdict',
  '',
  '说明: 本插件只维护一个开关状态并提供文本判定，不接管 DSH 内核的审批流程，',
  '      不会真正拦截、自动批准或改写任何工具调用。',
].join('\n');

export function apply(ctx, config) {
  // 初始化状态文件
  if (!existsSync(STATE_FILE)) {
    const initial = defaultState();
    initial.updatedAt = nowIso();
    saveState(initial);
  }

  function renderStatus() {
    const state = loadState();
    return [
      `🤖 Auto-mode: ${state.enabled ? '🟢 ON' : '🔴 OFF'}`,
      `   updatedAt: ${state.updatedAt || '（未知）'}`,
      `   状态文件: ${STATE_FILE}`,
      '',
      '注：该插件只提供开关与判定，不接管 DSH 内核的审批流程。',
    ].join('\n');
  }

  function toggle(enable) {
    const state = loadState();
    state.enabled = enable;
    state.updatedAt = nowIso();
    saveState(state);
    return [
      enable ? '🟢 Auto-mode 已标记为 ON' : '🔴 Auto-mode 已标记为 OFF',
      `   状态文件: ${STATE_FILE}`,
      '',
      '注：该标记仅为记录，不改变 DSH 内核的审批行为（本插件不接管审批流程）。',
    ].join('\n');
  }

  function renderCheck(command) {
    const { verdict, reason } = judge(command);
    const state = loadState();
    return [
      `🔎 命令: ${command}`,
      `   判定: ${verdict}`,
      `   依据: ${reason}`,
      `   当前 auto-mode 开关: ${state.enabled ? 'ON' : 'OFF'}（仅供参考）`,
      '',
      '注：这是离线文本判定，本插件不接管 DSH 内核的审批流程，',
      '    真实执行是否放行仍由内核的审批/沙箱决定。',
    ].join('\n');
  }

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'auto',
      description:
        'auto-mode 开关与危险命令判定：/auto on|off、/auto check <命令>。' +
        '仅提供开关与判定，不接管 DSH 内核的审批流程，不会真正拦截或自动批准工具调用。',
      input: { hint: '[on|off|check] <命令>' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim();
        if (raw === '') return { kind: 'success', text: renderStatus() };

        const m = raw.match(/^(\S+)\s*([\s\S]*)$/);
        const sub = m[1].toLowerCase();
        const rest = m[2].trim();

        if (sub === 'on' || sub === 'enable' || sub === 'true') {
          return { kind: 'success', text: toggle(true) };
        }
        if (sub === 'off' || sub === 'disable' || sub === 'false') {
          return { kind: 'success', text: toggle(false) };
        }
        if (sub === 'status' || sub === 'show') {
          return { kind: 'success', text: renderStatus() };
        }
        if (sub === 'check' || sub === 'test') {
          if (!rest) return { kind: 'error', text: `用法: /auto check <命令文本>\n\n${USAGE}` };
          return { kind: 'success', text: renderCheck(rest) };
        }

        return { kind: 'error', text: `未知子命令 "${sub}"。\n\n${USAGE}` };
      },
    });
    return () => dispose?.();
  });
}
