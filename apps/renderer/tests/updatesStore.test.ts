import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { UpdateResult, UpdateState } from '@fireeyeaud/shared';

import { createUpdatesStore, type UpdatesBridge } from '../src/store/updates.ts';

function state(patch: Partial<UpdateState> = {}): UpdateState {
  return {
    enabled: true,
    feedUrl: 'https://updates.example.com/',
    phase: 'idle',
    currentVersion: '1.0.0',
    availableVersion: null,
    percent: 0,
    bytesPerSecond: 0,
    error: null,
    ...patch,
  };
}

function ok(next: UpdateState): UpdateResult {
  return { ok: true, state: next };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeBridge(overrides: Partial<UpdatesBridge> = {}) {
  const listeners: Array<(next: UpdateState) => void> = [];
  const api: UpdatesBridge = {
    getState: async () => state(),
    setEnabled: async () => ok(state()),
    setFeedUrl: async () => ok(state()),
    check: async () => ok(state()),
    download: async () => ok(state()),
    install: async () => ok(state()),
    onState: (callback) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    ...overrides,
  };
  const emit = (next: UpdateState) => {
    for (const listener of [...listeners]) listener(next);
  };
  return { api, emit, listeners };
}

/** 静音并捕获 console.error，避免预期中的失败路径污染测试输出。 */
function captureConsoleError() {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
}

test('init applies the snapshot when no event arrives', async () => {
  const snapshot = state({ phase: 'available', availableVersion: '2.0.0' });
  const { api } = fakeBridge({ getState: async () => snapshot });
  const store = createUpdatesStore(api);

  await store.getState().init();

  assert.equal(store.getState().phase, 'available');
  assert.equal(store.getState().availableVersion, '2.0.0');
});

test('init ignores a snapshot that resolves after an onState event', async () => {
  const pending = deferred<UpdateState | null>();
  const { api, emit } = fakeBridge({ getState: () => pending.promise });
  const store = createUpdatesStore(api);

  const initPromise = store.getState().init();
  emit(state({ phase: 'available', availableVersion: '2.0.0' }));
  pending.resolve(state({ phase: 'idle', availableVersion: null }));
  await initPromise;

  assert.equal(store.getState().phase, 'available');
  assert.equal(store.getState().availableVersion, '2.0.0');
});

test('init failure logs, unsubscribes, resets the latch, and can retry', async () => {
  const log = captureConsoleError();
  let getStateCalls = 0;
  let unsubscribeCalls = 0;
  try {
    const { api } = fakeBridge({
      getState: async () => {
        getStateCalls += 1;
        if (getStateCalls === 1) throw new Error('ipc down');
        return state({ phase: 'not-available' });
      },
      onState: () => () => {
        unsubscribeCalls += 1;
      },
    });
    const store = createUpdatesStore(api);

    await store.getState().init();

    assert.equal(unsubscribeCalls, 1);
    assert.equal(log.calls.length, 1);
    assert.equal(store.getState().phase, 'idle');

    // 失败后 latch 必须复位，第二次 init 才能重新订阅并取快照。
    await store.getState().init();

    assert.equal(getStateCalls, 2);
    assert.equal(store.getState().phase, 'not-available');
  } finally {
    log.restore();
  }
});

test('commands apply result.state and only init subscribes once', async () => {
  const { api, listeners } = fakeBridge({
    getState: async () => state(),
    setEnabled: async () => ok(state({ enabled: false })),
  });
  const store = createUpdatesStore(api);

  await store.getState().init();
  await store.getState().init();
  assert.equal(listeners.length, 1);

  assert.deepEqual(await store.getState().setEnabled(false), {
    ok: true,
    error: undefined,
  });
  assert.equal(store.getState().enabled, false);
});

test('setEnabled reports a rejected persist and leaves state unchanged', async () => {
  const { api } = fakeBridge({
    setEnabled: async () => ({
      ok: false,
      error: 'persist_failed',
      state: state({ enabled: true }),
    }),
  });
  const store = createUpdatesStore(api);

  assert.deepEqual(await store.getState().setEnabled(false), {
    ok: false,
    error: 'persist_failed',
  });
  assert.equal(store.getState().enabled, true);
});

test('command rejection is swallowed and leaves the store unchanged', async () => {
  const log = captureConsoleError();
  try {
    const { api } = fakeBridge({
      check: async () => {
        throw new Error('ipc interrupted');
      },
    });
    const store = createUpdatesStore(api);

    await assert.doesNotReject(store.getState().check());

    assert.equal(store.getState().phase, 'idle');
    assert.equal(log.calls.length, 1);
  } finally {
    log.restore();
  }
});

test('setFeedUrl propagates ok/error and applies state on success', async () => {
  const invalid = fakeBridge({
    setFeedUrl: async () => ({
      ok: false,
      error: 'invalid_url',
      state: state({ feedUrl: 'https://old.example.com/' }),
    }),
  });
  const invalidStore = createUpdatesStore(invalid.api);
  assert.deepEqual(await invalidStore.getState().setFeedUrl('nope'), {
    ok: false,
    error: 'invalid_url',
  });
  assert.equal(invalidStore.getState().feedUrl, 'https://old.example.com/');

  const accepted = fakeBridge({
    setFeedUrl: async () => ok(state({ feedUrl: 'https://mirror.example.com/' })),
  });
  const acceptedStore = createUpdatesStore(accepted.api);
  assert.deepEqual(await acceptedStore.getState().setFeedUrl('https://mirror.example.com/'), {
    ok: true,
    error: undefined,
  });
  assert.equal(acceptedStore.getState().feedUrl, 'https://mirror.example.com/');
});

test('install rejection is swallowed', async () => {
  const log = captureConsoleError();
  try {
    const { api } = fakeBridge({
      install: async () => {
        throw new Error('app quitting');
      },
    });
    const store = createUpdatesStore(api);

    await assert.doesNotReject(store.getState().install());
    assert.equal(log.calls.length, 1);
  } finally {
    log.restore();
  }
});

test('commands are no-ops without a bridge', async () => {
  const store = createUpdatesStore(undefined);
  await assert.doesNotReject(store.getState().init());
  assert.deepEqual(await store.getState().setEnabled(false), { ok: false });
  assert.deepEqual(await store.getState().setFeedUrl('https://x.example.com/'), { ok: false });
  await assert.doesNotReject(store.getState().check());
  await assert.doesNotReject(store.getState().download());
  await assert.doesNotReject(store.getState().install());
  assert.equal(store.getState().enabled, true);
});
