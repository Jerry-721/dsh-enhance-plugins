/**
 * 插件自检脚本：校验 9 个本地 DSH 插件的包名、补丁格式、语法与导出。
 * 用法：node dsh-upgrades/verify-plugins.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = 'C:/Users/jerry/Documents/deepseek-harness/default-workspace';
const PROFILE = 'C:/Users/jerry/.dsh/profiles/desktop';

/** 期望：目录 -> {pkg, cmd} */
const PLUGINS = [
  ['dsh-skill-plugin', 'dsh-skill-manifest', 'skills'],
  ['dsh-approval-plugin', 'dsh-approval', 'approve'],
  ['dsh-mcp-plugin', 'dsh-mcp', 'mcp'],
  ['dsh-memory-plugin', 'dsh-memory', 'memory'],
  ['dsh-hooks-plugin', 'dsh-hooks', 'hooks'],
  ['dsh-auto-mode-plugin', 'dsh-auto-mode', 'auto'],
  ['dsh-agentic-loop-plugin', 'dsh-agentic-loop', 'loop'],
  ['dsh-sandbox-plugin', 'dsh-sandbox', 'sandbox'],
  ['dsh-canvas-plugin', 'dsh-canvas', 'canvas'],
];

const yaml = (await import(pathToFileURL(join(PROFILE, 'node_modules/js-yaml/index.js')).href)).default;

let failures = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => { failures += 1; console.log(`  FAIL  ${m}`); };

for (const [dir, pkgName, cmd] of PLUGINS) {
  const root = join(BASE, dir);
  console.log(`\n${dir} (期望包名 ${pkgName}，命令 /${cmd})`);

  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) { bad('缺少 package.json'); continue; }
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch (e) { bad(`package.json 不是合法 JSON: ${e.message}`); continue; }
  pkg.name === pkgName ? ok(`name = ${pkg.name}`) : bad(`name = ${pkg.name}（应为 ${pkgName}）`);
  pkg.type === 'module' ? ok('type = module') : bad(`type = ${pkg.type}（应为 module）`);
  pkg.dsh?.bundle?.patch ? ok(`bundle patch = ${pkg.dsh.bundle.patch}`) : bad('缺少 dsh.bundle.patch');

  const patchPath = join(root, 'cordis.patch.yml');
  if (!existsSync(patchPath)) bad('缺少 cordis.patch.yml');
  else {
    try {
      const doc = yaml.load(readFileSync(patchPath, 'utf8'));
      // 两种合法形态：裸行（覆盖既有 id）与 insert 列表（插入新行）
      const row = Array.isArray(doc)
        ? (doc[0]?.insert?.[0] ?? doc[0])
        : undefined;
      if (Array.isArray(doc) && row) {
        row.name === pkgName
          ? ok(`patch 数组格式（${doc[0]?.insert ? 'insert' : '裸行'}），id=${row.id}, name 匹配`)
          : bad(`patch 首项 name=${row.name}（应为 ${pkgName}）`);
      } else bad(`patch 顶层必须是数组，实际是 ${typeof doc}`);
    } catch (e) { bad(`patch YAML 解析失败: ${e.message.split('\n')[0]}`); }
  }

  const entryPath = join(root, pkg.main ?? 'index.js');
  if (!existsSync(entryPath)) { bad(`缺少入口 ${pkg.main ?? 'index.js'}`); continue; }
  const src = readFileSync(entryPath, 'utf8');

  /^\s*import[^;]*from\s+['"](?!node:)/mu.test(src)
    ? bad('index.js 存在非 node: 的外部 import（junction 下会解析失败）')
    : ok('index.js 仅使用 node: 内建模块');

  for (const marker of ['export const name', 'export const inject', 'export function apply']) {
    src.includes(marker) ? ok(`导出 ${marker.replace('export ', '')}`) : bad(`缺少 ${marker}`);
  }
  src.includes('ctx.provide') || src.includes("ctx.on('command/") ? bad('使用了不存在的 API ctx.provide / ctx.on(command/…)') : ok('未使用臆造 API');

  // stdio:'ignore'：受限沙箱下 Node 无法用管道捕获子进程输出（EPERM），只看退出码。
  const syntax = spawnSync(process.execPath, ['--check', entryPath], { stdio: 'ignore' });
  syntax.status === 0
    ? ok('node --check 语法通过')
    : bad(`语法错误（node --check 退出码 ${syntax.status}${syntax.error ? `, ${syntax.error.code}` : ''}）`);
}

// profile 层
console.log('\n--- profile 层 ---');
const manifest = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'));
const bundles = manifest.dsh?.profile?.bundles ?? [];
console.log(`  bundles = ${bundles.length}`);
for (const [, pkgName] of PLUGINS) {
  bundles.includes(pkgName) ? ok(`bundles 含 ${pkgName}`) : bad(`bundles 缺 ${pkgName}`);
  manifest.dependencies?.[pkgName] ? ok(`dependencies 含 ${pkgName}`) : bad(`dependencies 缺 ${pkgName}`);
  existsSync(join(PROFILE, 'node_modules', pkgName)) ? ok(`node_modules/${pkgName} 已链接`) : bad(`node_modules/${pkgName} 不存在`);
}

const patch = yaml.load(readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8'));
Array.isArray(patch) ? ok(`profile cordis.patch.yml 是数组（${patch.length} 项）`) : bad('profile cordis.patch.yml 不是数组');
const names = new Set(patch.map((e) => e.name));
for (const required of ['@deepseek-ai/dsh-llm-pi-ai', 'dsh-better-sidebar', '@linxin666/dsh-pet']) {
  names.has(required) ? ok(`patch 保留了 ${required}`) : bad(`patch 丢失 ${required}`);
}

console.log(`\n${failures === 0 ? '全部通过' : `共 ${failures} 项不通过`}`);
process.exit(failures === 0 ? 0 : 1);
