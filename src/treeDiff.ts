import type { TreeEntry } from '@/src/providers/types';

export interface TreeDiff {
  /** Source entries that are new or differ from the target (content or mode). */
  changed: TreeEntry[];
  /** Target entries that no longer exist in the source. */
  deleted: TreeEntry[];
  /** Changed blobs whose content the target does not already hold under any path. */
  toUpload: TreeEntry[];
}

/** Shared by the planner (for estimates) and the engine (for the run) so they cannot disagree. */
export function diffTrees(source: TreeEntry[], target: TreeEntry[]): TreeDiff {
  const src = source.filter((e) => e.type !== 'tree');
  const tgt = target.filter((e) => e.type !== 'tree');
  const targetByPath = new Map(tgt.map((e) => [e.path, e]));
  const sourcePaths = new Set(src.map((e) => e.path));
  const targetBlobShas = new Set(tgt.filter((e) => e.type === 'blob').map((e) => e.sha));

  const changed = src.filter((e) => {
    const existing = targetByPath.get(e.path);
    return !existing || existing.sha !== e.sha || existing.mode !== e.mode;
  });
  const deleted = tgt.filter((e) => !sourcePaths.has(e.path));
  const toUpload = changed.filter((e) => e.type === 'blob' && !targetBlobShas.has(e.sha));
  return { changed, deleted, toUpload };
}
