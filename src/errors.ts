/** Typed failures (SPEC §14 rule 9). Add a variant here instead of throwing a bare Error. */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AuthError =
  | { code: 'network'; message: string }
  | { code: 'device_flow_disabled' }
  | { code: 'invalid_client' }
  | { code: 'device_code_expired' }
  | { code: 'access_denied' }
  | { code: 'cancelled' }
  | { code: 'invalid_token' }
  | { code: 'unexpected_response'; detail: string };

/** Text shown to the user. Never includes a token. */
export function describeAuthError(e: AuthError): string {
  switch (e.code) {
    case 'network':
      return `Could not reach GitHub: ${e.message}`;
    case 'device_flow_disabled':
      return 'Device flow is not enabled for this GitHub OAuth App. Enable it in the app settings.';
    case 'invalid_client':
      return 'GitHub rejected the OAuth App client ID.';
    case 'device_code_expired':
      return 'The code expired before it was approved. Start the login again.';
    case 'access_denied':
      return 'Access was denied on GitHub.';
    case 'cancelled':
      return 'Login cancelled.';
    case 'invalid_token':
      return 'GitHub no longer accepts this login. Sign in again.';
    case 'unexpected_response':
      return `Unexpected response from GitHub: ${e.detail}`;
  }
}

/** Failures from GitHub API calls. `message` is GitHub's own error text, never a token. */
export type ApiError =
  | { code: 'network'; message: string }
  | { code: 'cancelled' }
  | { code: 'unauthorized' }
  | { code: 'forbidden'; message: string }
  | { code: 'not_found' }
  | { code: 'conflict'; message: string }
  | { code: 'validation'; message: string }
  | { code: 'rate_limited'; resetAt: number }
  | { code: 'http'; status: number; message: string }
  | { code: 'unexpected_response'; detail: string };

export function describeApiError(e: ApiError): string {
  switch (e.code) {
    case 'network':
      return `Could not reach GitHub: ${e.message}`;
    case 'cancelled':
      return 'Cancelled.';
    case 'unauthorized':
      return 'GitHub no longer accepts this login. Sign in again.';
    case 'forbidden':
      return `GitHub denied access: ${e.message}`;
    case 'not_found':
      return 'Not found. The repository may not exist, or your account may not have access to it.';
    case 'conflict':
      return `GitHub reported a conflict: ${e.message}`;
    case 'validation':
      return `GitHub rejected the request: ${e.message}`;
    case 'rate_limited':
      return `GitHub rate limit reached. It resets at ${new Date(e.resetAt).toLocaleTimeString()}.`;
    case 'http':
      return `GitHub returned ${e.status}: ${e.message}`;
    case 'unexpected_response':
      return `Unexpected response from GitHub: ${e.detail}`;
  }
}

export type EngineId = 'ref-copy' | 'tree-replay' | 'git-clone';

/** Detected while planning. Any blocker disables Execute (SPEC §7, §9). */
export type PlanBlocker =
  | { code: 'target_archived' }
  | { code: 'no_push_permission' }
  | { code: 'same_branch' }
  | { code: 'already_in_sync' }
  | { code: 'tree_truncated' }
  | { code: 'oversize_blob'; path: string; sizeBytes: number; limitBytes: number }
  | { code: 'lfs_detected'; path: string }
  | { code: 'missing_workflow_scope'; paths: string[] }
  | { code: 'rate_budget'; needed: number; remaining: number; resetAt: number }
  | { code: 'needs_force' }
  | { code: 'pr_base_missing' }
  | { code: 'branch_name_conflict'; existing: string }
  | { code: 'engine_unavailable'; engine: EngineId }
  | { code: 'unsupported'; what: 'last-n' };

export type PlanWarning =
  | { code: 'submodules'; count: number }
  | { code: 'sha_not_preserved' }
  | { code: 'target_branch_created'; from?: string }
  | { code: 'target_repo_empty' }
  | { code: 'write_access_unverified' }
  | { code: 'fork_probe_failed' };

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export function describePlanBlocker(b: PlanBlocker): string {
  switch (b.code) {
    case 'target_archived':
      return 'The target repository is archived, so it is read-only.';
    case 'no_push_permission':
      return 'Your account does not have write access to the target repository.';
    case 'same_branch':
      return 'Source and target are the same branch.';
    case 'already_in_sync':
      return 'The target already matches the source. Nothing to sync.';
    case 'tree_truncated':
      return 'The source has too many files for GitHub to list in one request. Latest-commit sync cannot handle it.';
    case 'oversize_blob':
      return `${b.path} is ${mb(b.sizeBytes)}, over the ${mb(b.limitBytes)} limit.`;
    case 'lfs_detected':
      return `${b.path} uses Git LFS. Syncing would copy pointer files without the real content, so it is blocked.`;
    case 'missing_workflow_scope':
      return `This sync changes ${b.paths.length} workflow file(s) under .github/workflows. Sign in again and grant the "workflow" permission.`;
    case 'rate_budget':
      return `This sync needs about ${b.needed} API calls but only ${b.remaining} remain. The limit resets at ${new Date(b.resetAt).toLocaleTimeString()}.`;
    case 'needs_force':
      return 'The target branch already exists. Pointing it at the source history rewrites it, so choose force push.';
    case 'pr_base_missing':
      return 'A pull request needs the target branch to exist already, because that is what it merges into.';
    case 'branch_name_conflict':
      return `The branch name conflicts with the existing branch "${b.existing}". Git cannot have both "a" and "a/b".`;
    case 'engine_unavailable':
      return b.engine === 'git-clone'
        ? 'Full history between repositories that are not forks of each other is not available yet.'
        : `The ${b.engine} engine is not available yet.`;
    case 'unsupported':
      return b.what === 'last-n'
        ? 'Last-N-commits sync is not available yet.'
        : 'Opening a pull request instead is not available yet.';
  }
}

export function describePlanWarning(w: PlanWarning): string {
  switch (w.code) {
    case 'submodules':
      return `${w.count} submodule(s) are copied as links only. The target must add the submodule content itself.`;
    case 'sha_not_preserved':
      return 'The new commit will have a different SHA than the source commit.';
    case 'target_branch_created':
      return w.from
        ? `The target branch does not exist. It will be created from ${w.from}, with one commit on top.`
        : 'The target branch does not exist and will be created (no shared history with the target).';
    case 'target_repo_empty':
      return 'The target repository is empty, so the first commit needs a special path.';
    case 'write_access_unverified':
      return 'GitHub did not say whether you can write to the target. The sync will fail if you cannot.';
    case 'fork_probe_failed':
      return 'The repositories do not share history storage, so the instant fork-network copy is not possible.';
  }
}

/** Raised while executing a plan. Includes every API failure. */
export type SyncError =
  | ApiError
  | { code: 'plan_blocked' }
  | { code: 'stale_plan' }
  | { code: 'blob_mismatch'; path: string }
  | { code: 'not_supported'; engine: EngineId }
  | { code: 'commit_unreachable' }
  | { code: 'protected_branch' }
  | { code: 'secret_scanning'; message: string }
  /** The branch was updated but opening the pull request failed. */
  | { code: 'pr_failed'; message: string };

export function describeSyncError(e: SyncError): string {
  switch (e.code) {
    case 'plan_blocked':
      return 'This sync has unresolved issues. Preview it again.';
    case 'stale_plan':
      return 'The target branch changed after the preview. Nothing was overwritten. Preview again to see the new state.';
    case 'blob_mismatch':
      return `${e.path} did not copy intact (the uploaded content hashed differently). Nothing was published.`;
    case 'not_supported':
      return `The ${e.engine} engine is not available yet.`;
    case 'commit_unreachable':
      return 'The target can no longer see the source commit, so the fork-network copy is not possible. Preview again.';
    case 'protected_branch':
      return 'The target branch is protected, so GitHub refused the update. Choose "Open a pull request", or sync to a different branch.';
    case 'secret_scanning':
      return `GitHub blocked this because it found what looks like a secret (push protection). It cannot be bypassed from here. ${e.message}`;
    case 'pr_failed':
      return `The branch was updated, but the pull request could not be opened: ${e.message}`;
    default:
      return describeApiError(e);
  }
}
