import type { Result, SyncError } from '@/src/errors';
import type { SyncPlan } from '@/src/plan';
import type { Credential, WritableProvider } from '@/src/providers/types';

export type ProgressPhase = 'preparing' | 'uploading' | 'building-tree' | 'committing' | 'updating-branch';

export interface Progress {
  phase: ProgressPhase;
  done: number;
  total: number;
  message: string;
}

export interface SyncResult {
  /** The commit the target branch now points at. */
  commitSha: string;
  filesChanged: number;
  blobsUploaded: number;
  /** Set in pull-request mode. */
  pullRequestUrl?: string;
}

export interface Engine {
  execute(
    provider: WritableProvider,
    plan: SyncPlan,
    credentials: { source: Credential; target: Credential },
    onProgress: (p: Progress) => void,
    signal: AbortSignal,
  ): Promise<Result<SyncResult, SyncError>>;
}
