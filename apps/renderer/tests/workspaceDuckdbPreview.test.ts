import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useUiStore, type DbDataTab } from '../src/store/ui.ts';

const resetTabs = () => useUiStore.getState().resetRightTabs();

const workspaceTable = (table: string) => ({
  id: 'workspace-duckdb',
  scope: 'project' as const,
  name: '账套.xlsx',
  driver: 'duckdb' as const,
  table: { table, columns: [{ name: 'x', type: 'VARCHAR' }] },
  source: 'workspace-duckdb' as const,
});

test('文件型数据源的表在工作区 DuckDB 预览里打开', async () => {
  resetTabs();
  await useUiStore.getState().openDbData({
    ...workspaceTable('src_ds1_a'),
    tabKey: 'workspace:ds_1',
  });
  const { rightTabs, activeRightTabId } = useUiStore.getState();
  assert.equal(rightTabs.length, 1);
  const tab = rightTabs[0] as DbDataTab;
  assert.equal(tab.kind, 'dbData');
  assert.equal(tab.source, 'workspace-duckdb');
  assert.equal(tab.driver, 'duckdb');
  assert.equal(tab.table.table, 'src_ds1_a');
  assert.equal(activeRightTabId, tab.id);
});

test('同一数据源重复点击复用同一个 tab', async () => {
  resetTabs();
  const open = () =>
    useUiStore.getState().openDbData({
      ...workspaceTable('src_ds1_a'),
      tabKey: 'workspace:ds_1',
    });
  await open();
  await open();
  assert.equal(useUiStore.getState().rightTabs.length, 1);
});

test('两个数据源的同名表（sheet1）各自一个 tab', async () => {
  resetTabs();
  await useUiStore.getState().openDbData({
    ...workspaceTable('src_ds1_sheet1'),
    tabKey: 'workspace:ds_1',
  });
  await useUiStore.getState().openDbData({
    ...workspaceTable('src_ds2_sheet1'),
    tabKey: 'workspace:ds_2',
  });
  const ids = useUiStore.getState().rightTabs.map((tab) => tab.id);
  assert.deepEqual(ids, [
    'dbData:workspace:ds_1:src_ds1_sheet1',
    'dbData:workspace:ds_2:src_ds2_sheet1',
  ]);
});

test('普通数据库连接的表默认仍是 connection 来源', async () => {
  resetTabs();
  await useUiStore.getState().openDbData({
    id: 'conn_1',
    scope: 'global',
    name: '库一',
    driver: 'sqlite',
    table: { table: 'users', columns: [] },
  });
  const tab = useUiStore.getState().rightTabs[0] as DbDataTab;
  assert.equal(tab.source, 'connection');
  assert.equal(tab.id, 'dbData:conn_1:users');
});