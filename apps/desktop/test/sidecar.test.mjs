import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SidecarManager, findFreePort, pythonExeFor } = require('../src/sidecar.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const silent = { info() {}, error() {} };

test('findFreePort returns an available port', async () => {
  const port = await findFreePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
});

test('sidecar starts, reports healthy, then stops', async () => {
  const manager = new SidecarManager({
    repoRoot,
    token: 'test-token',
    pythonExe: pythonExeFor(repoRoot),
    logger: silent,
    maxRestarts: 0,
  });

  const info = await manager.start();
  try {
    assert.equal(info.status, 'running');
    assert.equal(manager.health.status, 'ok');
  } finally {
    await manager.stop();
  }

  assert.equal(manager.status, 'stopped');
});

test('启动慢时不判死：后台探测到就绪后自动转为 running', async () => {
  // startWaitMs 设得很短：模拟「冷启动时机器很卡，5 秒内还没起来」。
  const manager = new SidecarManager({
    repoRoot,
    token: 'test-token',
    pythonExe: pythonExeFor(repoRoot),
    logger: silent,
    maxRestarts: 0,
    startWaitMs: 100,
    healthTimeoutMs: 60_000,
    healthIntervalMs: 100,
  });

  const statuses = [];
  manager.onStatus = (info) => statuses.push(info.status);

  const info = await manager.start();
  try {
    // 先返回，不阻塞等待；状态不能是 failed（否则前端会一直报连不上后端）。
    assert.notEqual(info.status, 'failed');

    const deadline = Date.now() + 60_000;
    while (manager.status !== 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(manager.status, 'running');
    assert.equal(manager.health.status, 'ok');
    assert.ok(statuses.includes('running'), '就绪后应主动广播 running');
  } finally {
    await manager.stop();
  }
});

test('管道输出按整行拼接，中文不会被分包截断', () => {
  const manager = new SidecarManager({ repoRoot, logger: silent, token: 't' });
  const lines = [];
  manager.logger = { info: (line) => lines.push(line), error: () => {} };

  // 模拟一个汉字被拆成两个 chunk（中文多字节，按字节切才会断）。
  const full = Buffer.from('应用启动完成\n', 'utf8');
  const half = full.indexOf(Buffer.from('应', 'utf8')[0]) + 1;
  manager._pipeOutput('err', full.subarray(0, half));
  manager._pipeOutput('err', full.subarray(half));

  assert.deepEqual(lines, ['[sidecar:err] 应用启动完成']);
});
