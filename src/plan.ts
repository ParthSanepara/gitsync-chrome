import type { EngineId, PlanBlocker, PlanWarning } from '@/src/errors';
import type { Commit, Credential, Repo } from '@/src/providers/types';

/** The commit message tree-replay proposes for its one new commit, before the user edits it. */
export function defaultCommitMessage(source: { repo: Repo; ref: string; commit: Commit }): string {
  return `Sync ${source.repo.fullName}@${source.ref} (${source.commit.sha.slice(0, 7)})`;
}

export type HistoryMode = 'snapshot' | 'lastN' | 'full';
export type WriteMode = 'push' | 'force-push' | 'pull-request';

export interface PlanRequest {
  source: { repo: Repo; ref: string };
  target: { repo: Repo; branch: string };
  mode: HistoryMode;
  /** Only for `lastN`. */
  n?: number;
  write: WriteMode;
  /** Read on the source, write on the target. They may be the same object. */
  credentials: { source: Credential; target: Credential };
}

/** What the preview shows and an engine executes (SPEC §7). Nothing downstream knows how it was planned. */
export interface SyncPlan {
  source: { repo: Repo; ref: string; commit: Commit };
  target: {
    repo: Repo;
    branch: string;
    exists: boolean;
    currentSha?: string;
    empty: boolean;
    /**
     * A branch that does not exist yet starts from the target's default branch, so it shares history and
     * only the differences are uploaded. Absent when the target has nothing to start from.
     */
    base?: { branch: string; sha: string };
  };
  mode: HistoryMode;
  n?: number;
  write: WriteMode;
  /** Pull-request mode syncs to `head` (a work branch, `target.branch`) and opens a PR into `base`. */
  pullRequest?: { base: string; head: string };
  engine: EngineId;
  /** Shown verbatim in the preview. */
  engineReason: string;
  /**
   * Set only when the engine creates exactly one new commit (tree-replay, snapshot mode). The preview
   * shows it pre-filled with `defaultCommitMessage`; the user may edit it before confirming (SPEC §14
   * rule 8 stays satisfied: this changes text on a commit the sync already makes, not a new feature).
   */
  commitMessage?: string;
  estimate: {
    filesChanged: number;
    blobsToUpload: number;
    commits: number;
    apiCalls: number;
    bytes: number;
  };
  warnings: PlanWarning[];
  /** Non-empty means Execute is disabled. */
  blockers: PlanBlocker[];
}
