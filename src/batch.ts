import {
  describeApiError,
  describePlanBlocker,
  describeSyncError,
  err,
  ok,
  type BatchError,
  type PlanBlocker,
  type Result,
} from '@/src/errors';
import type { Progress, SyncResult } from '@/src/engines/types';
import type { HistoryMode, SyncPlan } from '@/src/plan';
import { buildPlan } from '@/src/planner';
import type { Credential, Repo, WritableProvider } from '@/src/providers/types';
import { runSync } from '@/src/runner';

/** Each branch costs several API calls to plan. Past this, ask the user to narrow down. VERIFY against real budgets. */
export const MAX_BATCH_BRANCHES = 100;

/** Pull-request mode is one branch at a time: a batch would open a PR per branch. */
export interface BatchRequest {
  source: { repo: Repo };
  target: { repo: Repo };
  mode: HistoryMode;
  write: 'push' | 'force-push';
  credentials: { source: Credential; target: Credential };
}

export interface BatchItem {
  branch: string;
  plan?: SyncPlan;
  /** Planning this branch failed. Other branches are unaffected. */
  error?: string;
}

const perBranch = (req: BatchRequest, branch: string) => ({
  source: { repo: req.source.repo, ref: branch },
  target: { repo: req.target.repo, branch },
  mode: req.mode,
  write: req.write,
  credentials: req.credentials,
});

/** Whole-run problems: retrying the next branch would fail the same way. */
const fatal = (code: string) => code === 'unauthorized' || code === 'rate_limited';

/** Every source branch, default branch first, each planned against the same-named target branch. */
export async function planBatch(
  provider: WritableProvider,
  req: BatchRequest,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Result<BatchItem[], BatchError>> {
  const refs = await provider.listRefs(req.credentials.source, req.source.repo);
  if (!refs.ok) return refs;
  const def = req.source.repo.defaultBranch;
  const names = refs.value
    .filter((r) => r.kind === 'branch')
    .map((r) => r.name)
    .sort((a, b) => (a === def ? -1 : b === def ? 1 : a.localeCompare(b)));
  if (names.length > MAX_BATCH_BRANCHES)
    return err({ code: 'too_many_branches', count: names.length, limit: MAX_BATCH_BRANCHES });

  const items: BatchItem[] = [];
  for (const [i, branch] of names.entries()) {
    if (signal.aborted) return err({ code: 'cancelled' });
    onProgress(i, names.length);
    const plan = await buildPlan(provider, perBranch(req, branch));
    if (plan.ok) items.push({ branch, plan: plan.value });
    else if (fatal(plan.error.code)) return plan;
    else items.push({ branch, error: describeApiError(plan.error) });
  }
  onProgress(names.length, names.length);
  return ok(items);
}

export type BatchOutcome =
  | { status: 'synced'; result: SyncResult }
  | { status: 'up-to-date' }
  | { status: 'skipped'; reasons: string[] }
  | { status: 'failed'; message: string }
  | { status: 'not-run' };

export type BatchEvent =
  | { type: 'start'; branch: string; index: number; total: number }
  | { type: 'progress'; branch: string; progress: Progress }
  | { type: 'finish'; branch: string; outcome: BatchOutcome };

const onlyInSync = (blockers: PlanBlocker[]) =>
  blockers.length > 0 && blockers.every((b) => b.code === 'already_in_sync');

/**
 * Runs the chosen branches one at a time. Each is planned again right before it runs: syncing `main` moves the
 * tip that later new branches start from, so a plan made earlier would be stale by then.
 */
export async function runBatch(
  provider: WritableProvider,
  req: BatchRequest,
  branches: string[],
  onEvent: (e: BatchEvent) => void,
  signal: AbortSignal,
): Promise<Array<{ branch: string; outcome: BatchOutcome }>> {
  const results: Array<{ branch: string; outcome: BatchOutcome }> = [];
  let stop = false;

  for (const [index, branch] of branches.entries()) {
    const finish = (outcome: BatchOutcome) => {
      results.push({ branch, outcome });
      onEvent({ type: 'finish', branch, outcome });
    };
    if (stop || signal.aborted) {
      finish({ status: 'not-run' });
      continue;
    }
    onEvent({ type: 'start', branch, index, total: branches.length });

    const plan = await buildPlan(provider, perBranch(req, branch));
    if (!plan.ok) {
      if (fatal(plan.error.code)) stop = true;
      finish({ status: 'failed', message: describeApiError(plan.error) });
      continue;
    }
    if (plan.value.blockers.length > 0) {
      finish(
        onlyInSync(plan.value.blockers)
          ? { status: 'up-to-date' }
          : { status: 'skipped', reasons: plan.value.blockers.map(describePlanBlocker) },
      );
      continue;
    }

    const res = await runSync(
      provider,
      plan.value,
      req.credentials,
      (progress) => onEvent({ type: 'progress', branch, progress }),
      signal,
    );
    if (res.ok) finish({ status: 'synced', result: res.value });
    else {
      if (res.error.code === 'cancelled') stop = true;
      if (fatal(res.error.code)) stop = true;
      finish({ status: 'failed', message: describeSyncError(res.error) });
    }
  }
  return results;
}
