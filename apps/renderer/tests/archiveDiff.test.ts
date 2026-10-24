import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveConflictCheck } from '@fireeyeaud/shared';

import { describeConflict, isSameCheck } from '../src/lib/archiveDiff.ts';

function check(over: Partial<ArchiveConflictCheck>): ArchiveConflictCheck {
  return {
    diverged: false,
    behind: false,
    local: 'aaaa',
    remote: 'aaaa',
    base: null,
    conflicts: [],
    remoteOnly: [],
    localOnly: [],
    ...over,
  };
}

test('no remote configured', () => {
  assert.equal(describeConflict(check({ remote: null })).mode, 'no-remote');
});

test('a check that has not run yet is not mistaken for "no remote"', () => {
  assert.equal(describeConflict(undefined).mode, 'checking');
});

test('local has no commits yet', () => {
  assert.equal(describeConflict(check({ local: null })).mode, 'no-local');
});

test('diverged reports countable differences', () => {
  const view = describeConflict(
    check({
      diverged: true,
      conflicts: [
        { path: 'a', localStatus: 'modified', remoteStatus: 'modified', autoMerge: false },
      ],
      localOnly: ['b'],
      remoteOnly: ['c', 'd'],
    }),
  );
  assert.equal(view.mode, 'diverged');
  assert.equal(view.conflictCount, 1);
  assert.equal(view.localOnlyCount, 1);
  assert.equal(view.remoteOnlyCount, 2);
});

test('behind means the remote has commits the local does not', () => {
  const view = describeConflict(check({ behind: true, local: 'aaaa', remote: 'bbbb' }));
  assert.equal(view.mode, 'behind');
});

test('same sha is synced, different local sha is ahead', () => {
  assert.equal(describeConflict(check({ local: 'same', remote: 'same' })).mode, 'synced');
  assert.equal(describeConflict(check({ local: 'mine', remote: 'theirs' })).mode, 'ahead');
});

test('diverged wins over behind', () => {
  const view = describeConflict(check({ diverged: true, behind: true }));
  assert.equal(view.mode, 'diverged');
});

test('a stale check is detected when the commit pair changes', () => {
  const before = check({ local: 'mine', remote: 'theirs' });
  assert.equal(isSameCheck(before, { ...before }), true);
  assert.equal(isSameCheck(before, { ...before, local: 'newer' }), false);
  assert.equal(isSameCheck(before, null), false);
});