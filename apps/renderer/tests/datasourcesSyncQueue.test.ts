import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 对账请求合并规则的副本（与 src/store/datasources.ts 的 `mergeSyncRequest` 保持一致）。
 * datasources store 依赖 zustand/browser 环境，无法在 node:test 里直接导入，
 * 因此这里是纯函数副本；store 与测试一起改，保证行为一致。
 */
interface QueuedSync {
  full: boolean;
  background: boolean;
  foreground: boolean;
  sawFull?: boolean;
  sawBackground?: boolean;
}

interface SyncRun {
  full: boolean;
  background: boolean;
}

function mergeSyncRequest(pending: QueuedSync | null, run: SyncRun): QueuedSync {
  const sawFull = Boolean(pending?.sawFull || run.full);
  const sawBackground = Boolean(pending?.sawBackground || run.background);
  const hadForeground = Boolean(pending && !pending.background);
  return {
    full: sawFull && !hadForeground,
    background: true,
    // 出现过前台请求（待跑的或新的）都按前台呈现：用户手动操作用户要看得见。
    foreground: hadForeground || Boolean(pending?.foreground) || !run.background,
    sawFull,
    sawBackground,
  };
}

/** 补跑的实际形态：前台之外一律按后台准备处理。 */
function replay(queued: QueuedSync) {
  return { full: queued.full, background: queued.background && !queued.foreground };
}

const run = (full: boolean, background: boolean): SyncRun => ({ full, background });

/** 依次把请求排队（模拟：对账进行中连续来了几个请求）。 */
function queueAll(...runs: SyncRun[]): QueuedSync {
  let queued: QueuedSync | null = null;
  for (const item of runs) queued = mergeSyncRequest(queued, item);
  return queued as QueuedSync;
}

test('第二次增量请求合并成一次后台补跑', () => {
  const queued = mergeSyncRequest(null, run(false, true));
  assert.equal(queued.full, false);
  assert.equal(queued.foreground, false);
  assert.deepEqual(replay(queued), { full: false, background: true });

  const merged = mergeSyncRequest(queued, run(false, true));
  // 不并发：只补跑一次。
  assert.deepEqual(replay(merged), { full: false, background: true });
});

test('后台准备进行中用户点「重新导入」→ 补跑全量且按前台呈现', () => {
  const merged = queueAll(run(false, true), run(true, false));
  assert.deepEqual(replay(merged), { full: true, background: false });
});

test('前台全量进行中又来增量 → 保持前台全量，不被降级成后台增量', () => {
  const merged = queueAll(run(true, false), run(false, true));
  assert.deepEqual(replay(merged), { full: true, background: false });
});

test('先增量后全量再增量 → 全量标记不丢失', () => {
  const queued = queueAll(run(false, true), run(true, false), run(false, true));
  assert.deepEqual(replay(queued), { full: true, background: false });
});