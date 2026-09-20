import { err, ok, type Result, type SyncError } from '@/src/errors';
import type { Engine, Progress, SyncResult } from '@/src/engines/types';
import type { SyncPlan } from '@/src/plan';
import { TREE_CHUNK } from '@/src/planner';
import type { Credential, TreeEntry, TreeWrite, WritableProvider } from '@/src/providers/types';
import { diffTrees } from '@/src/treeDiff';

const UPLOAD_WORKERS = 4;
const cancelled = { code: 'cancelled' } as const;

/** See docs/ENGINES.md. Snapshot mode only. */
export const treeReplay: Engine = {
  async execute(provider, plan, credentials, onProgress, signal) {
    return run(provider, plan, credentials, onProgress, signal);
  },
};

async function run(
  provider: WritableProvider,
  plan: SyncPlan,
  credentials: { source: Credential; target: Credential },
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<Result<SyncResult, SyncError>> {
  if (plan.blockers.length > 0) return err({ code: 'plan_blocked' });
  if (plan.engine !== 'tree-replay' || plan.mode !== 'snapshot')
    return err({ code: 'not_supported', engine: plan.engine });

  const { source, target } = plan;
  const sCred = credentials.source;
  const tCred = credentials.target;
  const say = (phase: Progress['phase'], done: number, total: number, message: string) =>
    onProgress({ phase, done, total, message });

  say('preparing', 0, 1, 'Checking the target branch');
  let branch = await provider.getBranch(tCred, target.repo, target.branch);
  if (!branch.ok) return branch;

  // Never write over work the user did not see in the preview.
  const expectedSha = plan.target.currentSha;
  const nowSha = branch.value.state === 'exists' ? branch.value.sha : undefined;
  if (nowSha !== expectedSha) return err({ code: 'stale_plan' });
  if (signal.aborted) return err(cancelled);

  const sourceTree = await provider.getTree(sCred, source.repo, source.commit.treeSha);
  if (!sourceTree.ok) return sourceTree;
  if (sourceTree.value.truncated) return err({ code: 'plan_blocked' });

  // Empty target: the git data endpoints reject it, so the first file goes in through the Contents API.
  if (branch.value.state === 'empty-repo') {
    const first = sourceTree.value.entries.find((e) => e.type === 'blob');
    if (!first) return err({ code: 'plan_blocked' });
    say('preparing', 0, 1, 'Creating the first commit in the empty repository');
    const content = await provider.readBlob(sCred, source.repo, first.sha);
    if (!content.ok) return content;
    const created = await provider.createFirstFile(tCred, target.repo, {
      path: first.path,
      base64: content.value,
      message: 'Initial commit',
    });
    if (!created.ok) return created;
    branch = await provider.getBranch(tCred, target.repo, target.branch);
    if (!branch.ok) return branch;
  }

  // The tree the new commit is built on, and its parent, if the branch exists.
  let tipSha: string | undefined;
  let baseTreeSha: string | undefined;
  let targetEntries: TreeEntry[] = [];
  if (branch.value.state === 'exists') {
    tipSha = branch.value.sha;
    const tip = await provider.resolveRef(tCred, target.repo, tipSha);
    if (!tip.ok) return tip;
    baseTreeSha = tip.value.treeSha;
    const tree = await provider.getTree(tCred, target.repo, baseTreeSha);
    if (!tree.ok) return tree;
    if (tree.value.truncated) return err({ code: 'plan_blocked' });
    targetEntries = tree.value.entries;
  }

  const { changed, deleted, toUpload } = diffTrees(sourceTree.value.entries, targetEntries);
  if (changed.length + deleted.length === 0) return err({ code: 'plan_blocked' }); // planner would have said "in sync"

  // 1. Upload blobs, a few at a time. The client serializes the writes.
  let uploaded = 0;
  let failure: SyncError | undefined;
  let next = 0;
  const worker = async () => {
    while (!failure && !signal.aborted) {
      const entry = toUpload[next++];
      if (!entry) return;
      const content = await provider.readBlob(sCred, source.repo, entry.sha);
      if (!content.ok) return void (failure ??= content.error);
      if (signal.aborted) return;
      const sha = await provider.createBlob(tCred, target.repo, content.value);
      if (!sha.ok) return void (failure ??= sha.error);
      // Git is content-addressed: anything else means the copy is not the file we read.
      if (sha.value !== entry.sha) return void (failure ??= { code: 'blob_mismatch', path: entry.path });
      say('uploading', ++uploaded, toUpload.length, `Uploaded ${entry.path}`);
    }
  };
  say('uploading', 0, toUpload.length, `Uploading ${toUpload.length} file(s)`);
  await Promise.all(Array.from({ length: Math.min(UPLOAD_WORKERS, toUpload.length) }, worker));
  if (failure) return err(failure);
  if (signal.aborted) return err(cancelled);

  // 2. Trees: only changed paths, chained on the previous result. Deletions carry sha null.
  const writes: TreeWrite[] = [
    ...changed.map((e): TreeWrite => ({
      path: e.path,
      mode: e.mode,
      type: e.type === 'commit' ? 'commit' : 'blob',
      sha: e.sha,
    })),
    ...deleted.map((e): TreeWrite => ({
      path: e.path,
      mode: e.mode,
      type: e.type === 'commit' ? 'commit' : 'blob',
      sha: null,
    })),
  ];
  const chunks = Math.ceil(writes.length / TREE_CHUNK);
  let treeSha = baseTreeSha;
  for (let i = 0; i < chunks; i++) {
    say('building-tree', i, chunks, 'Building the new tree');
    const created = await provider.createTree(
      tCred,
      target.repo,
      writes.slice(i * TREE_CHUNK, (i + 1) * TREE_CHUNK),
      treeSha,
    );
    if (!created.ok) return created;
    treeSha = created.value;
    if (signal.aborted) return err(cancelled);
  }
  if (!treeSha) return err({ code: 'plan_blocked' });

  // 3. One commit on top of the target tip (parentless for a brand-new branch).
  say('committing', 0, 1, 'Creating the commit');
  const short = source.commit.sha.slice(0, 7);
  const commit = await provider.createCommit(tCred, target.repo, {
    message: `Sync ${source.repo.fullName}@${source.ref} (${short})`,
    treeSha,
    parents: tipSha ? [tipSha] : [],
  });
  if (!commit.ok) return commit;
  if (signal.aborted) return err(cancelled);

  // 4. Move the branch. Last, so a failure earlier leaves the target untouched.
  say('updating-branch', 0, 1, `Updating ${target.branch}`);
  const moved = tipSha
    ? await provider.updateRef(tCred, target.repo, target.branch, commit.value, plan.write === 'force-push')
    : await provider.createRef(tCred, target.repo, target.branch, commit.value);
  if (!moved.ok) return moved;

  say('updating-branch', 1, 1, 'Done');
  return ok({ commitSha: commit.value, filesChanged: changed.length + deleted.length, blobsUploaded: toUpload.length });
}
