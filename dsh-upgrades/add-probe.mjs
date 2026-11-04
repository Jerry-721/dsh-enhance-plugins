/**
 * 给 9 个插件的 apply() 开头注入"绝对路径探针"：
 * 每次宿主加载插件时，往 C:\Users\jerry\.dsh\plugin-boot.log 追加一行，
 * 记录插件名、时间、宿主进程的 cwd。
 *
 * 这个文件落在 ~/.dsh 根目录——已证实该目录可写（mcp-servers.json 就在那），
 * 所以只要能加载，就一定能留下痕迹。
 *
 * 用法：node dsh-upgrades/add-probe.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'C:/Users/jerry/Documents/deepseek-harness/default-workspace';
const DIRS = [
  'dsh-skill-plugin',
  'dsh-approval-plugin',
  'dsh-mcp-plugin',
  'dsh-memory-plugin',
  'dsh-hooks-plugin',
  'dsh-auto-mode-plugin',
  'dsh-agentic-loop-plugin',
  'dsh-sandbox-plugin',
  'dsh-canvas-plugin',
];

const PROOF_FILE = 'C:\\\\Users\\\\jerry\\\\.dsh\\\\plugin-boot.log';
const MARK = 'BOOT-PROBE';

function probeBlock(indent = '  ') {
  return [
    `${indent}// ${MARK}：加载自证（绝对路径，不依赖 cwd）`,
    `${indent}try {`,
    `${indent}  appendFileSync('${PROOF_FILE}', \`\${new Date().toISOString()} \${name} cwd=\${process.cwd()}\\n\`);`,
    `${indent}} catch {`,
    `${indent}  /* 探针失败不影响插件 */`,
    `${indent}}`,
    '',
  ].join('\n');
}

let changed = 0;

for (const dir of DIRS) {
  const file = join(BASE, dir, 'index.js');
  if (!existsSync(file)) { console.log(`跳过 ${dir}: 无 index.js`); continue; }

  let src = readFileSync(file, 'utf8');
  if (src.includes(MARK)) { console.log(`已是探针版 ${dir}`); continue; }

  // 1) 确保 node:fs 的 import 里有 appendFileSync
  const fsImport = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]node:fs['"];/u);
  if (fsImport) {
    if (!fsImport[1].includes('appendFileSync')) {
      const names = fsImport[1].trim().replace(/,$/, '');
      src = src.replace(fsImport[0], `import { appendFileSync, ${names} } from 'node:fs';`);
    }
  } else {
    // 没有 node:fs 的 import，就在第一处 import 前补一条
    src = src.replace(/^/u, `import { appendFileSync } from 'node:fs';\n`);
  }

  // 2) 在 apply 的左花括号后插入探针
  const applyMatch = src.match(/export function apply\([^)]*\)\s*\{/u);
  if (!applyMatch) { console.log(`跳过 ${dir}: 找不到 apply`); continue; }
  const at = applyMatch.index + applyMatch[0].length;
  src = `${src.slice(0, at)}\n${probeBlock()}${src.slice(at)}`;

  writeFileSync(file, src);
  changed += 1;
  console.log(`已注入探针 ${dir}`);
}

console.log(`\n完成，改动 ${changed} 个插件`);
