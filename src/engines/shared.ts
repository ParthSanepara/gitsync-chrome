import { err, ok, type ApiError, type Result, type SyncError } from '@/src/errors';
import type { SyncPlan } from '@/src/plan';
import type { Credential, WritableProvider } from '@/src/providers/types';

/**
 * Turns a raw API failure from a write into the specific problem the user can act on (SPEC §9).
 * VERIFY the message patterns against real refusals.
 */
export function mapWriteError(e: ApiError): SyncError {
  if (e.code === 'forbidden' || e.code === 'validation' || e.code === 'conflict') {
    if (/protected branch/i.test(e.message)) return { code: 'protected_branch' };
    if (/secret|push protection|GH013/i.test(e.message)) return { code: 'secret_scanning', message: e.message };
  }
  return e;
}

export const failed = (e: ApiError) => err(mapWriteError(e));

/** In pull-request mode, open the PR (or find the one already open for the work branch). */
export async function openPullRequestIfNeeded(
  provider: WritableProvider,
  plan: SyncPlan,
  cred: Credential,
): Promise<Result<string | undefined, SyncError>> {
  if (!plan.pullRequest) return ok(undefined);
  const { base, head } = plan.pullRequest;
  const repo = plan.target.repo;
  const title = `Sync ${plan.source.repo.fullName}@${plan.source.ref}`;
  const body = `Synced from ${plan.source.repo.fullName}@${plan.source.ref} (${plan.source.commit.sha.slice(0, 7)}) by GitSync.`;

  const created = await provider.openPullRequest(cred, repo, { title, body, head, base });
  if (created.ok) return ok(created.value.url);

  // A PR for this branch may already be open from an earlier run: the branch just got a new commit, so reuse it.
  if (created.error.code === 'validation' && /already exists/i.test(created.error.message)) {
    const existing = await provider.findOpenPullRequest(cred, repo, head, base);
    if (existing.ok && existing.value) return ok(existing.value.url);
  }
  return err({
    code: 'pr_failed',
    message:
      created.error.code === 'validation' || created.error.code === 'conflict' || created.error.code === 'forbidden'
        ? created.error.message
        : 'GitHub did not accept the request',
  });
}
