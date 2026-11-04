/**
 * 清理诊断探针：删掉 add-probe.mjs 注入的 BOOT-PROBE 块，
 * 以及随之残留的 appendFileSync 未使用导入。
 *
 * 用法：node dsh-upgrades/remove-probe.mjs
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

const PROBE_BLOCK = `  // BOOT-PROBE：加载自证（绝对路径，不依赖 cwd）
  try {
    appendFileSync('C:\\\\Users\\\\jerry\\\\.dsh\\\\plugin-boot.log', \`\${new Date().toISOString()} \${name} cwd=\${process.cwd()}\\n\`);
  } catch {
    /* 探针失败不影响插件 */
  }

`;

let changed = 0;

for (const dir of DIRS) {
  const file = join(BASE, dir, 'index.js');
  if (!existsSync(file)) continue;

  let src = readFileSync(file, 'utf8');
  const before = src;

  if (src.includes(PROBE_BLOCK)) src = src.split(PROBE_BLOCK).join('');

  // 清理未使用的 appendFileSync 导入
  if (!/appendFileSync\s*\(/u.test(src)) {
    src = src.replace(/import\s*\{\s*appendFileSync,\s*/u, 'import { ');
    src = src.replace(/import\s*\{\s*([^}]*?),\s*appendFileSync\s*\}/u, 'import { $1 }');
  }

  if (src !== before) {
    writeFileSync(file, src);
    changed += 1;
    console.log(`已清理 ${dir}`);
  } else {
    console.log(`无需改动 ${dir}`);
  }
}

console.log(`\n完成，改动 ${changed} 个文件`);
