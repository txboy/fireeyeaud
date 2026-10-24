import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useUiStore } from '../src/store/ui.ts';

test('opening an evidence form registers a closable workspace tab', async () => {
  useUiStore.getState().resetRightTabs();
  await useUiStore.getState().openEvidenceForm('QZ-0001', '关联方取证单');

  const state = useUiStore.getState();
  const tab = state.rightTabs.find((item) => item.kind === 'evidenceForm');
  assert.ok(tab);
  assert.equal(tab.id, 'form:QZ-0001');
  assert.equal(state.activeRightTabId, tab.id);
});

test('closing an evidence form tab by the same id prefix removes it', async () => {
  useUiStore.getState().resetRightTabs();
  await useUiStore.getState().openEvidenceForm('QZ-0001', '关联方取证单');
  // 面板删除取证单时用的就是 `form:<id>`，两侧必须一致，否则 tab 关不掉。
  await useUiStore.getState().closeRightTab('form:QZ-0001');
  assert.equal(
    useUiStore.getState().rightTabs.filter((item) => item.kind === 'evidenceForm').length,
    0,
  );
});

test('opening the same form twice keeps a single tab', async () => {
  useUiStore.getState().resetRightTabs();
  await useUiStore.getState().openEvidenceForm('QZ-0001', '旧标题');
  await useUiStore.getState().openEvidenceForm('QZ-0001', '新标题');

  const tabs = useUiStore.getState().rightTabs.filter((item) => item.kind === 'evidenceForm');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].name, '新标题');
});