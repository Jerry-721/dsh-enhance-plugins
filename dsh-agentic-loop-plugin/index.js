/**
 * DSH Agentic Loop Plugin — /loop
 *
 * 本地任务分解与进度跟踪，不自动执行步骤。
 * 状态文件：<cwd>/.dsh/agentic-loop.json
 *   { goal, steps: [{ id, desc, status }], current, status, createdAt }
 *
 * 用法：
 *   /loop plan <目标>    按关键词生成 4 步本地计划并写状态文件
 *   /loop status         显示目标、当前步与每步状态
 *   /loop next           当前步标记 done 并前进一格；全部完成则 status=completed
 *   /loop abort          把 status 置为 aborted
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-agentic-loop';
export const inject = ['commands'];

const DESCRIPTION = '本地任务分解与进度跟踪，不自动执行步骤';

const USAGE = [
  '用法：',
  '  /loop plan <目标>    生成 4 步计划（关键词匹配文档/表格/演示，否则通用）',
  '  /loop status         查看目标、当前步与每步状态',
  '  /loop next           当前步标记完成并前进一格',
  '  /loop abort          中止当前计划',
  '说明：纯本地规划与跟踪，不调用 LLM，也不会自动执行任何步骤。',
].join('\n');

const STEP_STATUS = {
  pending: 'pending',
  done: 'done',
};

function statePath(cwd) {
  return join(cwd, '.dsh', 'agentic-loop.json');
}

function readState(cwd) {
  const file = statePath(cwd);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(cwd, state) {
  const dir = join(cwd, '.dsh');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** 关键词 → 计划模板。顺序：文档 → 表格 → 演示 → 通用 */
function pickTemplate(goal) {
  if (/(word|docx|文档|报告|论文|文稿)/i.test(goal)) {
    return {
      kind: '文档（Word/docx）',
      steps: [
        '明确文档主题、读者与交付格式',
        '列出章节大纲与小节要点',
        '撰写正文，补齐数据、图表与引用',
        '通读校对并导出 .docx',
      ],
    };
  }
  if (/(excel|xlsx|表格|工作表|数据表|统计表)/i.test(goal)) {
    return {
      kind: '表格（Excel/xlsx）',
      steps: [
        '明确表格目标、统计口径与字段',
        '收集并清洗数据源',
        '写入工作簿，设置公式与格式',
        '核对计算结果并导出 .xlsx',
      ],
    };
  }
  if (/(ppt|pptx|演示|幻灯片|slides?|汇报)/i.test(goal)) {
    return {
      kind: '演示（PPT/pptx）',
      steps: [
        '明确演示目标、听众与时长',
        '列出页序与每页核心要点',
        '制作每页标题、要点与图示',
        '统一风格并导出 .pptx',
      ],
    };
  }
  return {
    kind: '通用任务',
    steps: [
      '明确目标、约束与验收标准',
      '把目标拆成可执行的子任务',
      '逐项执行并记录产出',
      '校验结果、收尾并记录遗留项',
    ],
  };
}

function formatSteps(state, showCurrent = true) {
  const lines = [];
  const current = Number.isInteger(state.current) ? state.current : 0;

  state.steps.forEach((step, index) => {
    const done = step.status === STEP_STATUS.done;
    const marker = done ? '[done]   ' : '[pending]';
    const pointer = showCurrent && index === current && state.status === 'active' ? '  ◀ 当前' : '';
    lines.push(`  ${marker} ${index + 1}. ${step.desc}${pointer}`);
  });

  return lines.join('\n');
}

function summarize(state) {
  const total = state.steps.length;
  const done = state.steps.filter((step) => step.status === STEP_STATUS.done).length;
  const current = Math.min(Number.isInteger(state.current) ? state.current : 0, total);
  let currentDesc = '（全部完成）';
  if (current < total) currentDesc = state.steps[current]?.desc ?? '（未知）';

  return [
    `目标：${state.goal}`,
    `状态：${state.status}`,
    `进度：${done}/${total} 步完成`,
    `当前步：${current < total ? current + 1 : total}/${total} — ${currentDesc}`,
    '步骤：',
    formatSteps(state),
  ].join('\n');
}

function planLoop(cwd, goal) {
  const template = pickTemplate(goal);
  const steps = template.steps.map((desc, index) => ({
    id: index + 1,
    desc,
    status: STEP_STATUS.pending,
  }));

  const state = {
    goal,
    steps,
    current: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  writeState(cwd, state);

  return [
    `已生成计划（本地关键词规划，未调用 LLM）：${template.kind}`,
    `目标：${goal}`,
    `状态文件：${statePath(cwd)}`,
    `当前步：1/${steps.length} — ${steps[0].desc}`,
    '步骤：',
    formatSteps(state),
    '用 /loop next 推进，/loop status 查看进度。',
  ].join('\n');
}

function statusLoop(cwd) {
  const state = readState(cwd);
  if (!state) {
    return { ok: false, text: `当前没有计划。先用 /loop plan <目标> 创建。\n状态文件：${statePath(cwd)}` };
  }
  return { ok: true, text: summarize(state) };
}

function nextLoop(cwd) {
  const state = readState(cwd);
  if (!state) {
    return { ok: false, text: `当前没有计划。先用 /loop plan <目标> 创建。\n状态文件：${statePath(cwd)}` };
  }
  if (state.status !== 'active') {
    return { ok: false, text: `当前计划状态为 ${state.status}，无法推进。用 /loop plan <目标> 重新开始。` };
  }

  const total = state.steps.length;
  const current = Number.isInteger(state.current) ? state.current : 0;

  if (current >= total) {
    state.status = 'completed';
    state.current = total;
    writeState(cwd, state);
    return { ok: true, text: `所有步骤已完成，状态置为 completed。\n${summarize(state)}` };
  }

  state.steps[current].status = STEP_STATUS.done;
  state.current = current + 1;

  let finishedNote = '';
  if (state.current >= total) {
    state.status = 'completed';
    state.current = total;
    finishedNote = '\n全部步骤已完成，状态置为 completed。';
  }

  writeState(cwd, state);
  return { ok: true, text: `已完成第 ${current + 1} 步：${state.steps[current].desc}${finishedNote}\n${summarize(state)}` };
}

function abortLoop(cwd) {
  const state = readState(cwd);
  if (!state) {
    return { ok: false, text: `当前没有计划可中止。\n状态文件：${statePath(cwd)}` };
  }

  const previous = state.status;
  state.status = 'aborted';
  writeState(cwd, state);

  return { ok: true, text: `已中止（原状态：${previous}）。\n${summarize(state)}` };
}

export function apply(ctx, config) {
  void config;

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'loop',
      description: DESCRIPTION,
      input: { hint: '<plan|status|next|abort> [目标]' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim();
        const cwd = process.cwd();

        if (!raw) return { kind: 'error', text: `缺少子命令。\n${USAGE}` };

        const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
        const sub = (m?.[1] ?? '').toLowerCase();
        const rest = (m?.[2] ?? '').trim();

        try {
          switch (sub) {
            case 'plan': {
              if (!rest) return { kind: 'error', text: `缺少目标。用法：/loop plan <目标>` };
              return { kind: 'success', text: planLoop(cwd, rest) };
            }
            case 'status': {
              const result = statusLoop(cwd);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            case 'next': {
              const result = nextLoop(cwd);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            case 'abort': {
              const result = abortLoop(cwd);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            default:
              return { kind: 'error', text: `未知子命令 "${sub}"。\n${USAGE}` };
          }
        } catch (error) {
          return {
            kind: 'error',
            text: `loop 执行失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    return () => {
      dispose?.();
    };
  });
}
