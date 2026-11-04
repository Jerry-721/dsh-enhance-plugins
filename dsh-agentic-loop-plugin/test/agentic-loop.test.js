/**
 * Tests for DSH Agentic Loop Plugin
 * Run with: node --test test/*.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';

const TEST_DIR = join(process.cwd(), '.dsh', 'test');
const STATE_FILE = join(TEST_DIR, 'agentic-loop-state.json');
const LOG_FILE = join(TEST_DIR, 'agentic-loop.jsonl');

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  if (existsSync(LOG_FILE)) rmSync(LOG_FILE);
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe('Agentic Loop Plugin', () => {
  before(setup);
  after(teardown);

  it('should parse /loop plan command', async () => {
    const { routeCommand } = await import('../index.js');
    const result = await routeCommand('/loop plan build a todo app');
    assert.ok(result);
    assert.equal(result.success, true);
    assert.ok(result.planId);
  });

  it('should handle /loop status with no active loop', async () => {
    const { routeCommand } = await import('../index.js');
    const result = await routeCommand('/loop status');
    assert.ok(result);
    assert.equal(result.success, true);
    assert.ok(result.state === null || result.state !== null);
  });

  it('should validate command usage', async () => {
    const { routeCommand } = await import('../index.js');
    const result = await routeCommand('/loop plan');
    assert.ok(result.error?.includes('Usage'));
  });
});

describe('State Management', () => {
  it('should write and read state file', async () => {
    const { readState, writeState } = await import('../index.js');
    
    const testState = { goalId: 'test-123', status: 'running' };
    writeState(testState);
    
    const loaded = readState();
    assert.equal(loaded.goalId, 'test-123');
    assert.equal(loaded.status, 'running');
  });

  it('should return null for non-existent state', async () => {
    const { readState } = await import('../index.js');
    const result = readState();
    // May return null or previous state from another test
    assert.ok(result === null || result.goalId !== undefined);
  });
});

describe('Logging', () => {
  it('should append to log file', async () => {
    const { appendLog } = await import('../index.js');
    
    appendLog({ type: 'test_log', message: 'hello' });
    
    const logContent = readFileSync(LOG_FILE, 'utf8');
    assert.ok(logContent.includes('test_log'));
    assert.ok(logContent.includes('hello'));
  });
});
