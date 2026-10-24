import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspaceStore } from '../src/store/reportWorkspace.ts';

function doc(id: string, sections: Array<{ id: string; title: string }>) {
  return {
    manifest: { id, title: id },
    body: {
      title: id,
      outlineApproved: false,
      sections: sections.map((section) => ({ ...section, level: 1, goal: '', blocks: [] })),
    },
    skeleton: {},
  } as never;
}

test('load caches the document by id', async () => {
  const store = createWorkspaceStore({
    get: async (id) => doc(id, [{ id: 'S1', title: '一、基本情况' }]),
    setOutline: async () => ({}),
  });
  const loaded = await store.getState().load('QZ-0001');
  assert.ok(loaded);
  assert.equal(store.getState().docs['QZ-0001'].manifest.id, 'QZ-0001');
  assert.equal(store.getState().loading['QZ-0001'], false);
});

test('load failure records a localisable error key and returns null', async () => {
  const store = createWorkspaceStore({
    get: async () => {
      throw Object.assign(new Error('boom'), { messageKey: 'error.artifactNotFound' });
    },
    setOutline: async () => ({}),
  });
  const loaded = await store.getState().load('QZ-9999');
  assert.equal(loaded, null);
  assert.equal(store.getState().errorKey, 'error.artifactNotFound');
  assert.equal(store.getState().loading['QZ-9999'], false);
});

test('saveOutline forwards the current sections instead of dropping them', async () => {
  const sent: Array<{ id: string; approved: boolean; titles: string[] }> = [];
  const store = createWorkspaceStore({
    get: async (id) => doc(id, [{ id: 'S1', title: '一、事项经过' }, { id: 'S2', title: '二、结论' }]),
    setOutline: async (id, sections, approved) => {
      sent.push({ id, approved, titles: sections.map((section) => section.title) });
      return {};
    },
  });
  await store.getState().load('QZ-0001');
  await store.getState().saveOutline('QZ-0001', true);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].approved, true);
  assert.deepEqual(sent[0].titles, ['一、事项经过', '二、结论']);
});

test('reset clears cached documents', async () => {
  const store = createWorkspaceStore({
    get: async (id) => doc(id, []),
    setOutline: async () => ({}),
  });
  await store.getState().load('QZ-0001');
  store.getState().reset();
  assert.deepEqual(store.getState().docs, {});
});