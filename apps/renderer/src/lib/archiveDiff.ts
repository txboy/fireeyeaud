import type { ArchiveConflictCheck } from '@fireeyeaud/shared';

export type ConflictViewMode =
  | 'checking'
  | 'no-remote'
  | 'no-local'
  | 'behind'
  | 'ahead'
  | 'synced'
  | 'diverged';

export interface ConflictView {
  mode: ConflictViewMode;
  conflictCount: number;
  localOnlyCount: number;
  remoteOnlyCount: number;
}

const EMPTY = { conflictCount: 0, localOnlyCount: 0, remoteOnlyCount: 0 };

/**
 * 「差异与冲突」页签该显示什么。
 *
 * 后端 check_conflict 的语义：
 * - remote 为空 → 未配置远程；
 * - local 为空 → 本地还没有任何提交；
 * - diverged → 双方都有改动，需要逐文件合并；
 * - behind → 远程领先（本地落后）；
 * - 其余：同一个 sha 既完全一致，不同则本地领先。
 *
 * 传 undefined 表示检查还没跑过——不能当成「没配远程」，
 * 否则网络 / 凭据错误会被误报成「先去配置远程」。
 */
export function describeConflict(
  check: ArchiveConflictCheck | null | undefined,
): ConflictView {
  if (check === undefined) return { mode: 'checking', ...EMPTY };
  if (!check || !check.remote) return { mode: 'no-remote', ...EMPTY };
  if (!check.local) return { mode: 'no-local', ...EMPTY };
  if (check.diverged) {
    return {
      mode: 'diverged',
      conflictCount: check.conflicts.length,
      localOnlyCount: check.localOnly.length,
      remoteOnlyCount: check.remoteOnly.length,
    };
  }
  if (check.behind) return { mode: 'behind', ...EMPTY };
  if (check.local === check.remote) return { mode: 'synced', ...EMPTY };
  return { mode: 'ahead', ...EMPTY };
}

/**
 * 提交合并前判断检查结果是否已经过期（例如期间又归档或另一台机器推送）。
 * 过期的选择集按文件路径对不上后端的新冲突集，必须先重新检查。
 */
export function isSameCheck(
  a: ArchiveConflictCheck | null,
  b: ArchiveConflictCheck | null,
): boolean {
  if (!a || !b) return a === b;
  return a.local === b.local && a.remote === b.remote && a.base === b.base;
}