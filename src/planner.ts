import { ok, type ApiError, type EngineId, type PlanBlocker, type PlanWarning, type Result } from '@/src/errors';
import type { PlanRequest, SyncPlan } from '@/src/plan';
import type { BranchState, Provider, TreeEntry } from '@/src/providers/types';

// SPEC §14 rule 4: this file imports Provider, never a concrete client.

/** GitHub's documented per-file ceiling. VERIFY empirically in M0 (SPEC §15 Q3). */
export const MAX_BLOB_BYTES = 100 * 1024 * 1024;
/** Largest `lastN` that tree-replay handles. Beyond this a real clone is cheaper. VERIFY in M0. */
export const TREE_REPLAY_MAX_N = 20;
/** Tree entries sent per create-tree call when chunking with base_tree. VERIFY the real limit. */
export const TREE_CHUNK = 1000;
/** API calls left untouched so the user's other GitHub work keeps running. */
const RATE_RESERVE = 100;
const MAX_GITATTRIBUTES_READS = 5;

const WORKFLOWS = '.github/workflows/';

export async function buildPlan(provider: Provider, req: PlanRequest): Promise<Result<SyncPlan, ApiError>> {
  const { source, target, credentials } = req;
  const blockers: PlanBlocker[] = [];
  const warnings: PlanWarning[] = [];

  const commit = await provider.resolveRef(credentials.source, source.repo, source.ref);
  if (!commit.ok) return commit;

  const branch = await provider.getBranch(credentials.target, target.repo, target.branch);
  if (!branch.ok) return branch;

  addTargetChecks(req, branch.value, blockers, warnings);

  // Engine selection, first match wins (SPEC §7).
  let engine: EngineId;
  let engineReason: string;
  if (req.mode === 'full') {
    const shares = await provider.canReachCommit(credentials.target, target.repo, commit.value.sha);
    if (!shares.ok) return shares;
    if (shares.value) {
      engine = 'ref-copy';
      engineReason =
        'The target can already see the source commit (a fork network), so its branch can point at it directly: full history in one API call.';
    } else {
      engine = 'git-clone';
      engineReason =
        'Full history between repositories that do not share a fork network needs a real git clone and push.';
      warnings.push({ code: 'fork_probe_failed' });
    }
  } else if (req.mode === 'snapshot' || (req.n ?? Infinity) <= TREE_REPLAY_MAX_N) {
    engine = 'tree-replay';
    engineReason =
      req.mode === 'snapshot'
        ? 'Latest commit only: upload the files that changed and create one new commit on the target.'
        : `Last ${req.n} commits: replay each one, uploading only the files that changed.`;
  } else {
    engine = 'git-clone';
    engineReason = `Replaying ${req.n} commits through the API is slow, so a real git clone is used.`;
  }

  if (req.write === 'pull-request') blockers.push({ code: 'unsupported', what: 'pull-request' });

  const base = {
    source: { repo: source.repo, ref: source.ref, commit: commit.value },
    target: {
      repo: target.repo,
      branch: target.branch,
      exists: branch.value.state === 'exists',
      currentSha: branch.value.state === 'exists' ? branch.value.sha : undefined,
      empty: branch.value.state === 'empty-repo',
    },
    mode: req.mode,
    n: req.n,
    write: req.write,
    engine,
    engineReason,
  };
  const zero = { filesChanged: 0, blobsToUpload: 0, commits: 0, apiCalls: 0, bytes: 0 };

  if (engine === 'ref-copy') {
    if (branch.value.state === 'exists') {
      if (branch.value.sha === commit.value.sha) blockers.push({ code: 'already_in_sync' });
      else if (req.write !== 'force-push') blockers.push({ code: 'needs_force' });
    } else {
      warnings.push({ code: 'target_branch_created' });
    }
    return ok(finish(provider, { ...base, estimate: { ...zero, apiCalls: 1 }, warnings, blockers }));
  }

  if (engine === 'git-clone') {
    blockers.push({ code: 'engine_unavailable', engine });
    const bytes = (source.repo.sizeKb ?? 0) * 1024;
    return ok(finish(provider, { ...base, estimate: { ...zero, bytes }, warnings, blockers }));
  }

  if (req.mode === 'lastN') {
    blockers.push({ code: 'unsupported', what: 'last-n' });
    return ok(finish(provider, { ...base, estimate: zero, warnings, blockers }));
  }

  // tree-replay, snapshot
  warnings.push({ code: 'sha_not_preserved' });
  const analysis = await analyseSnapshot(provider, req, commit.value.treeSha, branch.value);
  if (!analysis.ok) return analysis;
  blockers.push(...analysis.value.blockers);
  warnings.push(...analysis.value.warnings);
  return ok(finish(provider, { ...base, estimate: analysis.value.estimate, warnings, blockers }));
}

function addTargetChecks(
  req: PlanRequest,
  branch: BranchState,
  blockers: PlanBlocker[],
  warnings: PlanWarning[],
): void {
  const { source, target } = req;
  if (target.repo.archived) blockers.push({ code: 'target_archived' });
  if (target.repo.canPush === false) blockers.push({ code: 'no_push_permission' });
  else if (target.repo.canPush === undefined) warnings.push({ code: 'write_access_unverified' });
  if (source.repo.fullName === target.repo.fullName && source.ref === target.branch)
    blockers.push({ code: 'same_branch' });
  if (branch.state === 'missing') warnings.push({ code: 'target_branch_created' });
  if (branch.state === 'empty-repo') warnings.push({ code: 'target_repo_empty' });
}

async function analyseSnapshot(
  provider: Provider,
  req: PlanRequest,
  sourceTreeSha: string,
  branch: BranchState,
): Promise<Result<{ estimate: SyncPlan['estimate']; blockers: PlanBlocker[]; warnings: PlanWarning[] }, ApiError>> {
  const { source, target, credentials } = req;
  const blockers: PlanBlocker[] = [];
  const warnings: PlanWarning[] = [];

  const srcTree = await provider.getTree(credentials.source, source.repo, sourceTreeSha);
  if (!srcTree.ok) return srcTree;
  if (srcTree.value.truncated) {
    blockers.push({ code: 'tree_truncated' });
    return ok({
      estimate: { filesChanged: 0, blobsToUpload: 0, commits: 1, apiCalls: 0, bytes: 0 },
      blockers,
      warnings,
    });
  }
  const sourceEntries = srcTree.value.entries.filter((e) => e.type !== 'tree');

  // Target side: its current tree, so we upload only what differs.
  let targetEntries: TreeEntry[] = [];
  if (branch.state === 'exists') {
    const tip = await provider.resolveRef(credentials.target, target.repo, branch.sha);
    if (!tip.ok) return tip;
    const tgtTree = await provider.getTree(credentials.target, target.repo, tip.value.treeSha);
    if (!tgtTree.ok) return tgtTree;
    if (tgtTree.value.truncated) {
      blockers.push({ code: 'tree_truncated' });
      return ok({
        estimate: { filesChanged: 0, blobsToUpload: 0, commits: 1, apiCalls: 0, bytes: 0 },
        blockers,
        warnings,
      });
    }
    targetEntries = tgtTree.value.entries.filter((e) => e.type !== 'tree');
  }
  const targetByPath = new Map(targetEntries.map((e) => [e.path, e]));
  const sourcePaths = new Set(sourceEntries.map((e) => e.path));
  const targetBlobShas = new Set(targetEntries.filter((e) => e.type === 'blob').map((e) => e.sha));

  const changed = sourceEntries.filter((e) => {
    const existing = targetByPath.get(e.path);
    return !existing || existing.sha !== e.sha || existing.mode !== e.mode;
  });
  const deleted = targetEntries.filter((e) => !sourcePaths.has(e.path));
  const toUpload = changed.filter((e) => e.type === 'blob' && !targetBlobShas.has(e.sha));

  if (changed.length + deleted.length === 0) blockers.push({ code: 'already_in_sync' });

  const submodules = sourceEntries.filter((e) => e.type === 'commit').length;
  if (submodules > 0) warnings.push({ code: 'submodules', count: submodules });

  for (const e of toUpload) {
    if ((e.size ?? 0) > MAX_BLOB_BYTES)
      blockers.push({ code: 'oversize_blob', path: e.path, sizeBytes: e.size ?? 0, limitBytes: MAX_BLOB_BYTES });
  }

  const workflowPaths = [...changed, ...deleted].map((e) => e.path).filter((p) => p.startsWith(WORKFLOWS));
  if (workflowPaths.length > 0) {
    // Only OAuth tokens carry classic scopes. A fine-grained PAT's Workflows permission is not visible here.
    if (credentials.target.kind === 'oauth' && !credentials.target.scopes.includes('workflow')) {
      blockers.push({ code: 'missing_workflow_scope', paths: workflowPaths });
    }
  }

  // Pushing LFS pointers without their objects silently corrupts the target, so refuse (SPEC §8.3).
  const attributes = sourceEntries.filter(
    (e) => e.type === 'blob' && (e.path === '.gitattributes' || e.path.endsWith('/.gitattributes')),
  );
  for (const a of attributes.slice(0, MAX_GITATTRIBUTES_READS)) {
    const text = await provider.readBlobText(credentials.source, source.repo, a.sha);
    if (!text.ok) return text;
    if (/filter\s*=\s*lfs/i.test(text.value)) {
      blockers.push({ code: 'lfs_detected', path: a.path });
      break;
    }
  }

  const changedEntries = changed.length + deleted.length;
  const treeCalls = Math.max(1, Math.ceil(changedEntries / TREE_CHUNK));
  // Per new blob: read from the source, write to the target. Then the trees, one commit, one ref.
  const apiCalls = toUpload.length * 2 + treeCalls + 2;
  const bytes = toUpload.reduce((sum, e) => sum + (e.size ?? 0), 0);

  return ok({
    estimate: { filesChanged: changedEntries, blobsToUpload: toUpload.length, commits: 1, apiCalls, bytes },
    blockers,
    warnings,
  });
}

/** Adds the rate-limit budget check, which needs the final API-call estimate. */
function finish(provider: Provider, plan: SyncPlan): SyncPlan {
  const limit = provider.rateLimit();
  const needed = plan.estimate.apiCalls;
  if (limit && needed + RATE_RESERVE > limit.remaining) {
    plan.blockers.push({ code: 'rate_budget', needed, remaining: limit.remaining, resetAt: limit.resetAt });
  }
  return plan;
}
