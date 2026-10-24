import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useUiStore } from '../src/store/ui.ts';

const resetTabs = () => useUiStore.getState().resetRightTabs();

test('openArchiveDiff opens a single diff tab', async () => {
  resetTabs();
  const { openArchiveDiff } = useUiStore.getState();
  await openArchiveDiff();
  await openArchiveDiff();
  const { rightTabs, activeRightTabId } = useUiStore.getState();
  assert.equal(rightTabs.length, 1);
  assert.equal(rightTabs[0].kind, 'archiveDiff');
  assert.equal(activeRightTabId, rightTabs[0].id);
});

test('openArchiveChanges opens one tab per archive', async () => {
  resetTabs();
  const { openArchiveChanges } = useUiStore.getState();
  await openArchiveChanges('a1', '归档 1');
  await openArchiveChanges('a2', '归档 2');
  await openArchiveChanges('a1', '归档 1');
  const { rightTabs, activeRightTabId } = useUiStore.getState();
  assert.deepEqual(
    rightTabs.map((tab) => tab.id),
    ['archiveChanges:a1', 'archiveChanges:a2'],
  );
  assert.equal(activeRightTabId, 'archiveChanges:a1');
});

test('openArchiveRemote reuses a single remote settings tab', async () => {
  resetTabs();
  const { openArchiveRemote } = useUiStore.getState();
  await openArchiveRemote();
  await openArchiveRemote();
  const { rightTabs, activeRightTabId } = useUiStore.getState();
  assert.equal(rightTabs.length, 1);
  assert.equal(rightTabs[0].kind, 'archiveRemote');
  assert.equal(activeRightTabId, 'archiveRemote');
});

test('closing the active archive tab falls back to the previous tab', async () => {
  resetTabs();
  const s = useUiStore.getState();
  await s.openArchiveDiff();
  await s.openArchiveChanges('a1', '归档 1');
  const active = useUiStore.getState().activeRightTabId;
  await useUiStore.getState().closeRightTab(active);
  const { rightTabs, activeRightTabId } = useUiStore.getState();
  assert.deepEqual(
    rightTabs.map((tab) => tab.id),
    ['archiveDiff'],
  );
  assert.equal(activeRightTabId, 'archiveDiff');
});