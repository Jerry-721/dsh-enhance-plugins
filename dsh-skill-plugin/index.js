/**
 * DSH Skill Manifest Plugin — /skills
 *
 * 只做两件事：展示技能清单、按触发词给出匹配建议。
 * 不注入上下文、不拦截消息、不改变模型行为。
 *
 * 只依赖 node: 内建模块，可在没有 node_modules 的 junction 目录中直接加载。
 *
 * 用法：
 *   /skills list              列出技能名与触发词
 *   /skills match <用户原话>   按触发词匹配并给出建议技能
 *   /skills show <技能名>      查看某个技能的触发词与说明
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-skill-manifest';
export const inject = ['commands'];

const DESCRIPTION = '技能清单与关键词匹配建议，不改变模型行为';

/** 相对 cwd 的 manifest 路径 */
const MANIFEST_RELATIVE = join('dsh-upgrades', 'office-skills-manifest.json');

/**
 * 内置清单：manifest 不存在或无法解析时使用。
 * 与 dsh-upgrades/office-skills-manifest.json 的 7 条 office 技能保持一致。
 */
const BUILTIN_SKILLS = [
  {
    name: 'office',
    description: 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.',
    trigger: ['office', 'word', 'excel', 'ppt', 'powerpoint', '文档', '演示', '表格', 'office文档'],
    priority: 1,
    composite: true,
    subSkills: ['office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-export-pdf', 'office-recalculate'],
  },
  {
    name: 'office-docx',
    description: 'Create, read, edit, and validate Word documents (.docx).',
    trigger: ['docx', 'word', '文档', '创建word', '编辑word', '.docx'],
    priority: 10,
    composite: false,
    subSkills: ['office-render', 'office-export-pdf'],
  },
  {
    name: 'office-pptx',
    description: 'Create, read, edit, and validate PowerPoint presentations (.pptx).',
    trigger: ['pptx', 'powerpoint', '演示文稿', '幻灯片', '创建ppt', '.pptx'],
    priority: 10,
    composite: false,
    subSkills: ['office-render', 'office-export-pdf'],
  },
  {
    name: 'office-xlsx',
    description: 'Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx).',
    trigger: ['xlsx', 'excel', '表格', '工作簿', '创建excel', '公式', '.xlsx'],
    priority: 10,
    composite: false,
    subSkills: ['office-render', 'office-export-pdf', 'office-recalculate'],
  },
  {
    name: 'office-render',
    description: 'Render requested document images or inspect visual layout with LibreOffice Kit.',
    trigger: ['render', '预览', '图片', '视觉', 'layout', 'spacing', '对齐', '字体大小'],
    priority: 5,
    composite: false,
    subSkills: [],
  },
  {
    name: 'office-export-pdf',
    description: 'Convert an Office document to a requested PDF with LibreOffice Kit.',
    trigger: ['pdf', '导出', 'conversion', '转换为pdf'],
    priority: 5,
    composite: false,
    subSkills: [],
  },
  {
    name: 'office-recalculate',
    description: 'Refresh spreadsheet formula caches and verify calculated values with LibreOffice Kit.',
    trigger: ['recalculate', '公式', '计算', '刷新', '重新计算'],
    priority: 5,
    composite: false,
    subSkills: [],
  },
];

const USAGE = [
  '用法：',
  '  /skills list              列出技能名与触发词',
  '  /skills match <用户原话>   按触发词匹配并给出建议技能',
  '  /skills show <技能名>      查看某个技能的触发词与说明',
  '说明：只提供清单与关键词匹配建议，不改变模型行为。',
].join('\n');

/** 把 invocation.rawInput 拆成子命令 + 剩余原文 */
function parseRaw(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  if (!m) return { sub: '', rest: '' };
  return { sub: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

/** 把 manifest JSON 规整成统一的技能数组 */
function normalizeSkills(parsed) {
  const table = parsed?.skills;
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;

  const out = [];
  for (const [key, value] of Object.entries(table)) {
    if (!value || typeof value !== 'object') continue;
    const triggers = Array.isArray(value.trigger)
      ? value.trigger
      : Array.isArray(value.triggers)
        ? value.triggers
        : [];
    out.push({
      name: String(value.name || key),
      description: typeof value.description === 'string' ? value.description : '',
      trigger: triggers.map((t) => String(t)).filter(Boolean),
      priority: Number(value.priority) || 0,
      composite: value.composite === true,
      subSkills: Array.isArray(value.subSkills) ? value.subSkills.map((s) => String(s)) : [],
    });
  }
  return out.length > 0 ? out : null;
}

/** 启动时读取 manifest；读不到就用内置清单 */
function loadSkills(cwd) {
  const manifestPath = join(cwd, MANIFEST_RELATIVE);

  if (!existsSync(manifestPath)) {
    return {
      skills: BUILTIN_SKILLS,
      source: `内置清单（未找到 ${manifestPath}）`,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const skills = normalizeSkills(parsed);
    if (!skills) {
      return {
        skills: BUILTIN_SKILLS,
        source: `内置清单（${manifestPath} 缺少 skills 字段）`,
      };
    }
    return { skills, source: manifestPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      skills: BUILTIN_SKILLS,
      source: `内置清单（${manifestPath} 解析失败：${reason}）`,
    };
  }
}

/**
 * 按触发词匹配。
 * 打分：命中触发词的总长度 + 命中数量权重；同分按 priority 降序。
 */
function matchSkills(query, skills) {
  const q = String(query).toLowerCase();
  const hits = [];

  for (const skill of skills) {
    const matched = skill.trigger.filter((t) => q.includes(String(t).toLowerCase()));
    if (matched.length === 0) continue;
    const score = matched.reduce((sum, t) => sum + String(t).length, 0) + matched.length * 2;
    hits.push({ skill, matched, score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.skill.priority - a.skill.priority ||
      a.skill.name.localeCompare(b.skill.name),
  );
  return hits;
}

function formatList(skills, source) {
  const lines = [`技能清单（共 ${skills.length} 项）`, `来源：${source}`, ''];
  for (const skill of skills) {
    const triggers = skill.trigger.length > 0 ? skill.trigger.join('、') : '（无触发词）';
    lines.push(`- ${skill.name}: ${triggers}`);
  }
  lines.push('', '说明：只提供清单与关键词匹配建议，不改变模型行为。');
  return lines.join('\n');
}

function formatMatch(query, hits) {
  if (hits.length === 0) {
    return [
      `输入：${query}`,
      '没有匹配到任何技能。',
      '可以用 /skills list 查看全部技能，或用 /skills show <技能名> 查看详情。',
    ].join('\n');
  }

  const [best, ...others] = hits;
  const lines = [
    `输入：${query}`,
    `建议技能：${best.skill.name}（命中触发词：${best.matched.join('、')}）`,
  ];

  if (best.skill.description) lines.push(`说明：${best.skill.description}`);
  if (best.skill.composite && best.skill.subSkills.length > 0) {
    lines.push(`组合技能，可展开：${best.skill.subSkills.join('、')}`);
  }
  if (others.length > 0) {
    const rest = others
      .slice(0, 5)
      .map((h) => `${h.skill.name}（命中：${h.matched.join('、')}）`)
      .join('；');
    lines.push(`其他候选：${rest}`);
  }

  lines.push('', '提示：这只是关键词建议，不改变模型行为。');
  return lines.join('\n');
}

function formatShow(skill) {
  const lines = [`技能：${skill.name}`];
  lines.push(`触发词：${skill.trigger.length > 0 ? skill.trigger.join('、') : '（无触发词）'}`);
  lines.push(`说明：${skill.description || '（manifest 未提供说明）'}`);
  if (skill.composite) {
    lines.push(`类型：组合技能，子技能：${skill.subSkills.length > 0 ? skill.subSkills.join('、') : '（无）'}`);
  }
  return lines.join('\n');
}

export function apply(ctx, config) {
  void config; // 路径固定为 <cwd>/dsh-upgrades/office-skills-manifest.json

  // 启动时读取一次；读不到则回退内置清单
  const loaded = loadSkills(process.cwd());

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'skills',
      description: DESCRIPTION,
      input: { hint: '<list|match|show> [参数]' },
      handler(invocation) {
        const raw = invocation?.rawInput ?? '';
        const { sub, rest } = parseRaw(raw);

        if (!sub) return { kind: 'error', text: `缺少子命令。\n${USAGE}` };

        try {
          switch (sub) {
            case 'list':
              return { kind: 'success', text: formatList(loaded.skills, loaded.source) };

            case 'match': {
              if (!rest) return { kind: 'error', text: `缺少要匹配的原话。\n用法：/skills match <用户原话>` };
              return { kind: 'success', text: formatMatch(rest, matchSkills(rest, loaded.skills)) };
            }

            case 'show': {
              if (!rest) return { kind: 'error', text: '缺少技能名。\n用法：/skills show <技能名>' };
              const wanted = rest.toLowerCase();
              const exact = loaded.skills.find((s) => s.name.toLowerCase() === wanted);
              const fuzzy = exact
                ? null
                : loaded.skills.find((s) => s.name.toLowerCase().includes(wanted));
              const found = exact ?? fuzzy;

              if (!found) {
                const names = loaded.skills.map((s) => s.name).join('、');
                return { kind: 'error', text: `没有名为 "${rest}" 的技能。\n现有技能：${names}` };
              }
              return { kind: 'success', text: formatShow(found) };
            }

            default:
              return { kind: 'error', text: `未知子命令 "${sub}"。\n${USAGE}` };
          }
        } catch (error) {
          return {
            kind: 'error',
            text: `skills 执行失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    return () => {
      dispose?.();
    };
  });
}
