/**
 * DSH Approval Plugin — /approve
 *
 * 只做策略的查看与判定：给出一段命令文本 / 正则，告诉你按本地策略
 * 应当「拒绝 / 需确认 / 自动放行」。不接管 DSH 内核审批，也不会真的
 * 拦截任何工具调用。
 *
 * 只依赖 node: 内建模块，可在没有 node_modules 的 junction 目录中直接加载。
 *
 * 用法：
 *   /approve list                 显示当前策略
 *   /approve check <命令文本>      按 deny → confirm → autoAllow 顺序判定
 *   /approve deny <正则>           加入拒绝规则（并从另两组移除）
 *   /approve allow <正则>          加入自动放行（并从另两组移除）
 *   /approve reset                恢复默认策略
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const name = 'dsh-approval';
export const inject = ['commands'];

const DESCRIPTION = '策略判定与查看，不接管 DSH 内核审批';

const POLICY_PATH = join(homedir(), '.dsh', 'approval-policy.json');

const DEFAULT_POLICY = {
  autoAllow: ['read', 'grep', 'glob'],
  confirm: ['write', 'edit', 'pwsh', 'bash'],
  deny: [],
};

const USAGE = [
  '用法：',
  '  /approve list                 显示当前策略',
  '  /approve check <命令文本>      按 deny → confirm → autoAllow 顺序判定',
  '  /approve deny <正则>           加入拒绝规则',
  '  /approve allow <正则>          加入自动放行',
  '  /approve reset                恢复默认策略',
  '说明：本命令只做策略判定与查看，不接管 DSH 内核审批。',
].join('\n');

/** 把 invocation.rawInput 拆成子命令 + 剩余原文 */
function parseRaw(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  if (!m) return { sub: '', rest: '' };
  return { sub: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

function clonePolicy(policy) {
  return {
    ...policy,
    autoAllow: [...policy.autoAllow],
    confirm: [...policy.confirm],
    deny: [...policy.deny],
  };
}

function sanitizeList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

/** 读取策略；文件不存在或不可用时回退默认策略 */
function loadPolicy() {
  if (!existsSync(POLICY_PATH)) {
    return { policy: clonePolicy(DEFAULT_POLICY), source: `默认策略（${POLICY_PATH} 不存在）` };
  }

  try {
    const parsed = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
    const policy = {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      autoAllow: sanitizeList(parsed?.autoAllow, DEFAULT_POLICY.autoAllow),
      confirm: sanitizeList(parsed?.confirm, DEFAULT_POLICY.confirm),
      deny: sanitizeList(parsed?.deny, DEFAULT_POLICY.deny),
    };
    return { policy, source: POLICY_PATH };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { policy: clonePolicy(DEFAULT_POLICY), source: `默认策略（${POLICY_PATH} 读取失败：${reason}）` };
  }
}

function savePolicy(policy) {
  mkdirSync(dirname(POLICY_PATH), { recursive: true });
  writeFileSync(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

/** 单条规则匹配：能编译成正则就按正则，否则退化为大小写不敏感子串 */
function ruleMatches(rule, text) {
  let re = null;
  try {
    re = new RegExp(rule, 'i');
  } catch {
    re = null;
  }
  if (re) return re.test(text);
  return text.toLowerCase().includes(String(rule).toLowerCase());
}

function isUsableRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 按 deny → confirm → autoAllow 顺序判定 */
function evaluate(policy, text) {
  const order = [
    { key: 'deny', verdict: '拒绝' },
    { key: 'confirm', verdict: '需确认' },
    { key: 'autoAllow', verdict: '自动放行' },
  ];

  for (const { key, verdict } of order) {
    for (const rule of policy[key]) {
      if (ruleMatches(rule, text)) {
        return { verdict, rule: `${key}: ${rule}` };
      }
    }
  }
  return { verdict: '需确认', rule: '未命中任何规则（默认需确认）' };
}

function formatPolicy(policy, source) {
  const fmt = (list) => (list.length > 0 ? list.join(', ') : '(空)');
  return [
    '当前审批策略',
    `来源：${source}`,
    `autoAllow（自动放行）: ${fmt(policy.autoAllow)}`,
    `confirm（需确认）: ${fmt(policy.confirm)}`,
    `deny（拒绝）: ${fmt(policy.deny)}`,
    '',
    '判定顺序：deny → confirm → autoAllow；都未命中时按「需确认」处理。',
    '说明：本命令只做策略判定与查看，不接管 DSH 内核审批。',
  ].join('\n');
}

function formatCheck(text, verdict, hit) {
  return [
    `命令：${text}`,
    `判定：${verdict.verdict}`,
    `命中规则：${hit.rule}`,
    `策略文件：${POLICY_PATH}`,
    '说明：本命令只做策略判定与查看，不接管 DSH 内核审批。',
  ].join('\n');
}

/** 从另两组里移除同一个模式，保持 deny → confirm → autoAllow 的语义一致 */
function removeFrom(policy, pattern, keepKey) {
  for (const key of ['autoAllow', 'confirm', 'deny']) {
    if (key === keepKey) continue;
    policy[key] = policy[key].filter((rule) => rule !== pattern);
  }
}

export function apply(ctx, config) {
  void config; // 策略文件固定为 ~/.dsh/approval-policy.json

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'approve',
      description: DESCRIPTION,
      input: { hint: '<list|check|deny|allow|reset> [参数]' },
      handler(invocation) {
        const raw = invocation?.rawInput ?? '';
        const { sub, rest } = parseRaw(raw);

        if (!sub) return { kind: 'error', text: `缺少子命令。\n${USAGE}` };

        try {
          switch (sub) {
            case 'list': {
              const { policy, source } = loadPolicy();
              return { kind: 'success', text: formatPolicy(policy, source) };
            }

            case 'check': {
              if (!rest) {
                return { kind: 'error', text: '缺少要判定的命令文本。\n用法：/approve check <命令文本>' };
              }
              const { policy } = loadPolicy();
              const hit = evaluate(policy, rest);
              return { kind: 'success', text: formatCheck(rest, hit, hit) };
            }

            case 'deny':
            case 'allow': {
              if (!rest) {
                return { kind: 'error', text: `缺少正则。\n用法：/approve ${sub} <正则>` };
              }
              if (!isUsableRegex(rest)) {
                return { kind: 'error', text: `"${rest}" 不是合法的正则表达式，未修改策略。` };
              }
              const target = sub === 'deny' ? 'deny' : 'autoAllow';
              const { policy } = loadPolicy();

              removeFrom(policy, rest, target);
              if (!policy[target].includes(rest)) policy[target].push(rest);

              savePolicy(policy);
              return {
                kind: 'success',
                text: [
                  `已写入 ${target}：${rest}`,
                  sub === 'deny' ? '（如该正则原本在 confirm / autoAllow 中，已一并移除）' : '（如该正则原本在 deny / confirm 中，已一并移除）',
                  `策略文件：${POLICY_PATH}`,
                  '',
                  formatPolicy(policy, POLICY_PATH),
                ].join('\n'),
              };
            }

            case 'reset': {
              const policy = clonePolicy(DEFAULT_POLICY);
              savePolicy(policy);
              return {
                kind: 'success',
                text: [`已恢复默认策略。`, '', formatPolicy(policy, POLICY_PATH)].join('\n'),
              };
            }

            default:
              return { kind: 'error', text: `未知子命令 "${sub}"。\n${USAGE}` };
          }
        } catch (error) {
          return {
            kind: 'error',
            text: `approve 执行失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    return () => {
      dispose?.();
    };
  });
}
