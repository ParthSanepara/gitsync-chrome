import { err, ok } from '@/src/errors';
import { openPullRequestIfNeeded } from '@/src/engines/shared';
import type { Engine } from '@/src/engines/types';
import type { CloneJob } from '@/src/messaging';
import { ensureOffscreenDocument, runCloneJob } from '@/src/offscreenClient';
import type { Repo } from '@/src/providers/types';

// GitHub is the only provider today (ProviderId = 'github'). The git wire protocol lives on github.com,
// not api.github.com (`provider.host`). VERIFY this split when a second host is added.
const cloneUrl = (repo: Repo) => `https://github.com/${repo.fullName}.git`;

/**
 * Full history across repositories that do not share a fork network: a real clone and push, run in the
 * offscreen document since it can take minutes (SPEC §8.3, §14 rule 2). VERIFY the open questions in
 * SPEC §15 (Q1-Q3) empirically; this engine ships ahead of a completed M0 spike (DECISIONS 0016).
 */
export const gitClone: Engine = {
  async execute(provider, plan, credentials, onProgress, signal) {
    if (plan.blockers.length > 0) return err({ code: 'plan_blocked' });
    if (plan.engine !== 'git-clone' || plan.mode !== 'full') return err({ code: 'not_supported', engine: plan.engine });
    if (signal.aborted) return err({ code: 'cancelled' });

    const { source, target } = plan;
    const tCred = credentials.target;

    onProgress({ phase: 'preparing', done: 0, total: 1, message: 'Checking the target branch' });
    const branch = await provider.getBranch(tCred, target.repo, target.branch);
    if (!branch.ok) return branch;
    // Never write over work the user did not see in the preview.
    const nowSha = branch.value.state === 'exists' ? branch.value.sha : undefined;
    if (nowSha !== plan.target.currentSha) return err({ code: 'stale_plan' });
    if (signal.aborted) return err({ code: 'cancelled' });

    const ready = await ensureOffscreenDocument();
    if (!ready.ok) return ready;
    if (signal.aborted) return err({ code: 'cancelled' });

    const job: CloneJob = {
      source: { cloneUrl: cloneUrl(source.repo), ref: source.ref, credential: { token: credentials.source.token } },
      target: {
        cloneUrl: cloneUrl(target.repo),
        branch: target.branch,
        credential: { token: tCred.token },
        force: plan.write === 'force-push',
      },
    };

    const cloned = await runCloneJob(job, onProgress, signal);
    if (!cloned.ok) return cloned;

    const pr = await openPullRequestIfNeeded(provider, plan, tCred);
    if (!pr.ok) return pr;

    onProgress({ phase: 'updating-branch', done: 1, total: 1, message: 'Done' });
    return ok({ commitSha: cloned.value.commitSha, filesChanged: 0, blobsUploaded: 0, pullRequestUrl: pr.value });
  },
};
