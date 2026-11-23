import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQuitFlow } = require('../src/quit-flow.cjs');

const silent = () => ({ info() {}, error() {} });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeEvent() {
  return {
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
  };
}

/** 等微任务链（stopSidecar → finishQuit）跑完。 */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function makeFlow({ sidecar, updater, ...options } = {}) {
  const exits = [];
  const app = { exit: (code) => exits.push(code) };
  const flow = createQuitFlow({
    app,
    sidecar,
    getUpdater: () => updater,
    logger: silent(),
    ...options,
  });
  return { flow, exits };
}

function makeUpdater({ ready = false, quitAndInstall } = {}) {
  return {
    installs: 0,
    isUpdateReady: () => ready,
    quitAndInstall:
      quitAndInstall ??
      function quitAndInstall() {
        this.installs += 1;
        return true;
      },
  };
}

test('关闭过程中再次请求退出仍被拦截，不会提前 exit', async () => {
  const pending = deferred();
  let stopCalls = 0;
  const sidecar = {
    stop: () => {
      stopCalls += 1;
      return pending.promise;
    },
  };
  const { flow, exits } = makeFlow({ sidecar, updater: makeUpdater() });

  const first = fakeEvent();
  const second = fakeEvent();
  flow.onBeforeQuit(first);
  flow.onBeforeQuit(second);

  assert.equal(first.prevented, 1);
  assert.equal(second.prevented, 1);
  await Promise.resolve();
  assert.equal(stopCalls, 1);
  assert.deepEqual(exits, []);

  pending.resolve();
  await flush();
  assert.deepEqual(exits, [0]);
});

test('没有就绪更新时先停 sidecar，再正常 exit(0)', async () => {
  const pending = deferred();
  let stopCalls = 0;
  const sidecar = {
    stop: () => {
      stopCalls += 1;
      return pending.promise;
    },
  };
  const { flow, exits } = makeFlow({ sidecar, updater: makeUpdater() });

  flow.onBeforeQuit(fakeEvent());
  await Promise.resolve();
  assert.equal(stopCalls, 1);
  assert.deepEqual(exits, []);

  pending.resolve();
  await flush();
  assert.deepEqual(exits, [0]);
});

test('已下载更新时只调用一次 quitAndInstall，并放行后续退出请求', async () => {
  const pending = deferred();
  const sidecar = { stop: () => pending.promise };
  const updater = makeUpdater({ ready: true });
  const { flow, exits } = makeFlow({ sidecar, updater, installTimeoutMs: 5 });

  const first = fakeEvent();
  flow.onBeforeQuit(first);
  pending.resolve();
  await flush();

  assert.equal(first.prevented, 1);
  assert.equal(updater.installs, 1);
  assert.deepEqual(exits, []);

  // quitAndInstall 内部会再次 app.quit()：此时必须直接放行。
  const reentrant = fakeEvent();
  flow.onBeforeQuit(reentrant);
  assert.equal(reentrant.prevented, 0);

  // 安装器没有让进程退出时，看门狗兜底 exit。
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(exits, [0]);
  assert.equal(updater.installs, 1);
});

test('quitAndInstall 抛错时仍会 exit(0)', async () => {
  const sidecar = { stop: () => Promise.resolve() };
  const updater = makeUpdater({
    ready: true,
    quitAndInstall() {
      throw new Error('installer boom');
    },
  });
  const { flow, exits } = makeFlow({ sidecar, updater });

  flow.onBeforeQuit(fakeEvent());
  await flush();
  assert.deepEqual(exits, [0]);
});

test('sidecar.stop 拒绝时仍会退出', async () => {
  const sidecar = { stop: () => Promise.reject(new Error('stop failed')) };
  const { flow, exits } = makeFlow({ sidecar, updater: makeUpdater() });

  flow.onBeforeQuit(fakeEvent());
  await flush();
  assert.deepEqual(exits, [0]);
});

test('sidecar.stop 一直不返回时超时继续退出', async () => {
  const sidecar = { stop: () => new Promise(() => {}) };
  const { flow, exits } = makeFlow({
    sidecar,
    updater: makeUpdater(),
    sidecarStopTimeoutMs: 5,
  });

  flow.onBeforeQuit(fakeEvent());
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(exits, [0]);
});

test('stopWorkspaceWatch 在重复退出请求下只调用一次', async () => {
  const pending = deferred();
  const sidecar = { stop: () => pending.promise };
  let watches = 0;
  const { flow, exits } = makeFlow({
    sidecar,
    updater: makeUpdater(),
    stopWorkspaceWatch: () => {
      watches += 1;
    },
  });

  flow.onBeforeQuit(fakeEvent());
  flow.onBeforeQuit(fakeEvent());

  assert.equal(watches, 1);

  pending.resolve();
  await flush();
  assert.deepEqual(exits, [0]);
  assert.equal(watches, 1);
});
