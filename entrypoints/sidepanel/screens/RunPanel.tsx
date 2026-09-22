import { useState } from 'react';
import type { SyncResult, Progress } from '@/src/engines/types';
import type { SyncPlan } from '@/src/plan';

export type RunState =
  | { status: 'idle' }
  | { status: 'confirm' }
  | { status: 'running'; progress?: Progress }
  | { status: 'done'; result: SyncResult }
  | { status: 'failed'; message: string };

interface Props {
  plan: SyncPlan;
  run: RunState;
  /** The commit message to use, when `plan.commitMessage` is set and the user may have edited it. */
  onConfirm: (commitMessage?: string) => void;
  onCancel: () => void;
  onBack: () => void;
  onReset: () => void;
}

const primary =
  'rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900';
const secondary =
  'rounded-md border border-slate-400 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800';

export function RunPanel({ plan, run, onConfirm, onCancel, onBack, onReset }: Props) {
  const to = `${plan.target.repo.fullName}@${plan.target.branch}`;
  // Only set for the one-new-commit engines (tree-replay, snapshot mode). Re-initializes whenever a
  // fresh plan mounts this component; Setup.tsx unmounts it between previews (SPEC §7).
  const [commitMessage, setCommitMessage] = useState(plan.commitMessage ?? '');

  if (run.status === 'confirm') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Confirm</h2>
        <p className="text-sm">
          {plan.pullRequest ? (
            <>
              This copies{' '}
              <strong>
                {plan.source.repo.fullName}@{plan.source.ref}
              </strong>{' '}
              to the branch <strong>{plan.pullRequest.head}</strong> in {plan.target.repo.fullName} and opens a pull
              request into <strong>{plan.pullRequest.base}</strong>. <code>{plan.pullRequest.base}</code> is not
              changed.
            </>
          ) : plan.engine === 'ref-copy' ? (
            <>
              This points <strong>{to}</strong> at the latest commit of{' '}
              <strong>
                {plan.source.repo.fullName}@{plan.source.ref}
              </strong>
              , keeping its full history.
            </>
          ) : plan.engine === 'git-clone' ? (
            <>
              This clones the full history of{' '}
              <strong>
                {plan.source.repo.fullName}@{plan.source.ref}
              </strong>{' '}
              and pushes it to <strong>{to}</strong>, preserving the original commits. This can take a while for a large
              repository.
            </>
          ) : (
            <>
              This copies the latest commit of{' '}
              <strong>
                {plan.source.repo.fullName}@{plan.source.ref}
              </strong>{' '}
              into <strong>{to}</strong> as one new commit{plan.target.exists ? '' : ', on a new branch'}.
            </>
          )}
        </p>
        {plan.commitMessage !== undefined && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Commit message</span>
            <textarea
              className="rounded-md border border-slate-400 p-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              rows={2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </label>
        )}
        {plan.write === 'force-push' && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Force push is on: the target branch can be overwritten.
          </p>
        )}
        <div className="flex gap-2">
          <button className={primary} onClick={() => onConfirm(commitMessage)}>
            Sync now
          </button>
          <button className={secondary} onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    );
  }

  if (run.status === 'running') {
    const p = run.progress;
    const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="text-sm font-semibold">Syncing to {to}</h2>
        <div className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-slate-900 dark:bg-slate-100" style={{ width: `${pct}%` }} />
        </div>
        <p className="truncate text-xs text-slate-500">{p ? `${p.message} (${p.done}/${p.total})` : 'Starting…'}</p>
        <button className={secondary + ' self-start'} onClick={onCancel}>
          Cancel
        </button>
        <p className="text-xs text-slate-500">Keep this panel open until it finishes.</p>
      </section>
    );
  }

  if (run.status === 'done') {
    const url = `https://github.com/${plan.target.repo.fullName}/commit/${run.result.commitSha}`;
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">Synced</h2>
        <p className="text-sm">
          {plan.engine === 'ref-copy'
            ? `${to} now points at the source commit.`
            : plan.engine === 'git-clone'
              ? `${to} now has the full history of the source branch, ending at ${run.result.commitSha.slice(0, 7)}.`
              : `${run.result.filesChanged} file(s) changed, ${run.result.blobsUploaded} uploaded, in one commit on ${to}.`}
        </p>
        {run.result.pullRequestUrl && (
          <a className={primary + ' text-center'} href={run.result.pullRequestUrl} target="_blank" rel="noreferrer">
            Open the pull request
          </a>
        )}
        <a
          className={run.result.pullRequestUrl ? secondary + ' text-center' : primary + ' text-center'}
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          View commit {run.result.commitSha.slice(0, 7)}
        </a>
        <button className={secondary + ' self-start'} onClick={onReset}>
          Done
        </button>
      </section>
    );
  }

  if (run.status === 'failed') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Sync did not finish</h2>
        <p role="alert" className="text-sm">
          {run.message}
        </p>
        <button className={secondary + ' self-start'} onClick={onReset}>
          Back
        </button>
      </section>
    );
  }

  return null;
}
