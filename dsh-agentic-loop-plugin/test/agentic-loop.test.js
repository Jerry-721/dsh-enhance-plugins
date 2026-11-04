/**
 * dsh-agentic-loop 单元测试
 *
 * 运行：npm test   或   node --test
 *
 * 插件是命令式形态（apply 里注册 commands），所以这里用一个假 ctx 抓住
 * 注册进来的 handler，直接拿 rawInput 调它，再看返回的 kind / text 和落盘的状态文件。
 * 状态文件写在 process.cwd() 下，因此每个用例切到独立临时目录。
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { apply } from '../index.js';

/** 用假 ctx 跑一次 apply，把注册到的 handler 交出来 */
function loadHandler() {
  let handler = null;
  const ctx = {
    effect(fn) {
      return fn();
    },
    commands: {
      register(entry) {
        handler = entry.handler;
        return () => {};
      },
    },
  };
  apply(ctx, {});
  assert.ok(handler, 'apply 应当注册 loop 命令');
  return handler;
}

const run = (handler, raw) => handler({ rawInput: raw });
const readState = (dir) => JSON.parse(readFileSync(join(dir, '.dsh', 'agentic-loop.json'), 'utf8'));

describe('dsh-agentic-loop', () => {
  let dir;
  let prevCwd;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dsh-loop-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('没有子命令时返回错误', () => {
    const h = loadHandler();
    const r = run(h, '');
    assert.equal(r.kind, 'error');
    assert.match(r.text, /缺少子命令/);
  });

  test('plan 缺目标时给用法提示', () => {
    const h = loadHandler();
    const r = run(h, 'plan');
    assert.equal(r.kind, 'error');
    assert.match(r.text, /用法/);
  });

  test('plan 按关键词选文档模板并落盘', () => {
    const h = loadHandler();
    const r = run(h, 'plan 写一份课程报告');
    assert.equal(r.kind, 'success');
    assert.match(r.text, /文档（Word\/docx）/);
    assert.ok(existsSync(join(dir, '.dsh', 'agentic-loop.json')), '应写出状态文件');

    const state = readState(dir);
    assert.equal(state.goal, '写一份课程报告');
    assert.equal(state.steps.length, 4);
    assert.equal(state.current, 0);
    assert.equal(state.status, 'active');
    assert.ok(state.steps.every((s) => s.status === 'pending'));
  });

  test('plan 能识别表格 / 演示 / 通用三种模板', () => {
    const h = loadHandler();
    assert.match(run(h, 'plan 做一张统计表').text, /表格（Excel\/xlsx）/);
    assert.match(run(h, 'plan 准备汇报幻灯片').text, /演示（PPT\/pptx）/);
    assert.match(run(h, 'plan 随便干点啥').text, /通用任务/);
  });

  test('status 没有计划时提示先 plan', () => {
    const h = loadHandler();
    const r = run(h, 'status');
    assert.equal(r.kind, 'error');
    assert.match(r.text, /先用 \/loop plan/);
  });

  test('next 逐步推进，最后置为 completed', () => {
    const h = loadHandler();
    run(h, 'plan 写文档');

    for (let i = 0; i < 4; i += 1) {
      assert.equal(run(h, 'next').kind, 'success', `第 ${i + 1} 次 next 应成功`);
    }

    const state = readState(dir);
    assert.equal(state.status, 'completed');
    assert.equal(state.current, 4);
    assert.ok(state.steps.every((s) => s.status === 'done'));
  });

  test('abort 之后不能再推进', () => {
    const h = loadHandler();
    run(h, 'plan 写文档');

    assert.equal(run(h, 'abort').kind, 'success');
    assert.equal(readState(dir).status, 'aborted');

    const n = run(h, 'next');
    assert.equal(n.kind, 'error');
    assert.match(n.text, /无法推进/);
  });

  test('未知子命令返回错误', () => {
    const h = loadHandler();
    const r = run(h, 'dance');
    assert.equal(r.kind, 'error');
    assert.match(r.text, /未知子命令/);
  });
});
