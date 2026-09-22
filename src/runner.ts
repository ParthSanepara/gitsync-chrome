import type { Result, SyncError } from '@/src/errors';
import { gitClone } from '@/src/engines/gitClone';
import { refCopy } from '@/src/engines/refCopy';
import { treeReplay } from '@/src/engines/treeReplay';
import type { Progress, SyncResult } from '@/src/engines/types';
import type { SyncPlan } from '@/src/plan';
import type { Credential, WritableProvider } from '@/src/providers/types';

/** The only door to the engines: UI calls this and never imports an engine (SPEC §14 rule 3). */
export function runSync(
  provider: WritableProvider,
  plan: SyncPlan,
  credentials: { source: Credential; target: Credential },
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<Result<SyncResult, SyncError>> {
  switch (plan.engine) {
    case 'tree-replay':
      return treeReplay.execute(provider, plan, credentials, onProgress, signal);
    case 'ref-copy':
      return refCopy.execute(provider, plan, credentials, onProgress, signal);
    case 'git-clone':
      return gitClone.execute(provider, plan, credentials, onProgress, signal);
  }
}
