/**
 * 插件运行时冒烟测试：用假 ctx 真实调用每个插件的 apply()，捕获异常。
 * 比静态检查更接近真相——DSH 加载插件时也是这样调用 apply 的。
 *
 * 用法：node dsh-upgrades/smoke-plugins.mjs
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

/** 造一个足够像 Cordis 的 ctx */
function fakeCtx() {
  const registered = [];
  const disposers = [];
  return {
    registered,
    workspace: { root: process.cwd() },
    effect(fn) {
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
    },
    commands: {
      register(entry) {
        registered.push(entry);
        return () => {};
      },
    },
    disposeAll() {
      for (const d of disposers) d();
    },
  };
}

let failures = 0;

for (const dir of DIRS) {
  const entry = join(BASE, dir, 'index.js');
  if (!existsSync(entry)) {
    console.log(`FAIL  ${dir}: 缺少 index.js`);
    failures += 1;
    continue;
  }

  try {
    const mod = await import(pathToFileURL(entry).href);
    const missing = ['name', 'inject', 'apply'].filter((k) => mod[k] === undefined);
    if (missing.length > 0) {
      console.log(`FAIL  ${dir}: 缺少导出 ${missing.join(', ')}`);
      failures += 1;
      continue;
    }

    const ctx = fakeCtx();
    const result = mod.apply(ctx, { enabled: true });
    if (result && typeof result.then === 'function') await result;

    const cmd = ctx.registered[0];
    if (!cmd) {
      console.log(`FAIL  ${dir}: apply 后没有注册任何命令`);
      failures += 1;
      continue;
    }

    // 用空输入跑一次 handler，确认至少不抛异常
    let handlerNote = 'handler 未调用（需要参数）';
    try {
      const out = cmd.handler({ rawInput: '', agent: {}, session: {} });
      if (out && typeof out.then === 'function') await out;
      handlerNote = 'handler 空输入正常';
    } catch (error) {
      handlerNote = `handler 抛异常: ${error.message}`;
      failures += 1;
    }

    ctx.disposeAll();
    console.log(`OK    ${dir}  name=${mod.name}  cmd=/${cmd.name}  ${handlerNote}`);
  } catch (error) {
    console.log(`FAIL  ${dir}: apply 抛异常 -> ${error.message}`);
    failures += 1;
  }
}

console.log(`\n${failures === 0 ? '运行时冒烟全部通过' : `${failures} 个插件存在问题`}`);
process.exit(failures === 0 ? 0 : 1);
