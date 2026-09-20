import { err, ok } from '@/src/errors';
import { failed, openPullRequestIfNeeded } from '@/src/engines/shared';
import type { Engine } from '@/src/engines/types';

/**
 * Full history across a fork network: point a target branch at a commit that only exists in the source.
 * One write. See docs/ENGINES.md. VERIFY against a real fork before relying on it.
 */
export const refCopy: Engine = {
  async execute(provider, plan, credentials, onProgress, signal) {
    if (plan.blockers.length > 0) return err({ code: 'plan_blocked' });
    if (plan.engine !== 'ref-copy') return err({ code: 'not_supported', engine: plan.engine });

    const { source, target } = plan;
    const tCred = credentials.target;
    const say = (done: number, message: string) => onProgress({ phase: 'updating-branch', done, total: 1, message });

    say(0, 'Checking the target branch');
    const branch = await provider.getBranch(tCred, target.repo, target.branch);
    if (!branch.ok) return branch;
    // Never move a branch the user did not see in the preview.
    const nowSha = branch.value.state === 'exists' ? branch.value.sha : undefined;
    if (nowSha !== plan.target.currentSha) return err({ code: 'stale_plan' });
    if (signal.aborted) return err({ code: 'cancelled' });

    // The planner probed this already. Probe again: it is the actual precondition, and it costs one call.
    const reachable = await provider.canReachCommit(tCred, target.repo, source.commit.sha);
    if (!reachable.ok) return reachable;
    if (!reachable.value) return err({ code: 'commit_unreachable' });
    if (signal.aborted) return err({ code: 'cancelled' });

    say(0, `Pointing ${target.branch} at ${source.commit.sha.slice(0, 7)}`);
    // Moving an existing branch to unrelated history is not a fast-forward. The plan required force push
    // for that, except for a pull-request work branch, which is ours to move.
    const moved =
      branch.value.state === 'exists'
        ? await provider.updateRef(tCred, target.repo, target.branch, source.commit.sha, plan.write !== 'push')
        : await provider.createRef(tCred, target.repo, target.branch, source.commit.sha);
    if (!moved.ok) return failed(moved.error);

    const pr = await openPullRequestIfNeeded(provider, plan, tCred);
    if (!pr.ok) return pr;

    say(1, 'Done');
    return ok({ commitSha: source.commit.sha, filesChanged: 0, blobsUploaded: 0, pullRequestUrl: pr.value });
  },
};
