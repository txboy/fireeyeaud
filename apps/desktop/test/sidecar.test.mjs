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
