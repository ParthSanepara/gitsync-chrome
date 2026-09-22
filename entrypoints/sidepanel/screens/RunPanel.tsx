import { useState } from 'react';
import type { SyncResult, Progress } from '@/src/engines/types';
import type { SyncPlan } from '@/src/plan';
import { Button, fieldClass, LinkButton, mutedTextClass } from '../ui';

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

export function RunPanel({ plan, run, onConfirm, onCancel, onBack, onReset }: Props) {
  const to = `${plan.target.repo.fullName}@${plan.target.branch}`;
  // Only set for the one-new-commit engines (tree-replay, snapshot mode). Re-initializes whenever a
  // fresh plan mounts this component; Setup.tsx unmounts it between previews (SPEC §7).
  const [commitMessage, setCommitMessage] = useState(plan.commitMessage ?? '');

  if (run.status === 'confirm') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Confirm</h2>
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
            <span className="text-slate-500 dark:text-slate-400">Commit message</span>
            <textarea
              className={fieldClass}
              rows={2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </label>
        )}
        {plan.write === 'force-push' && (
          <p className="text-sm text-[#9a6700] dark:text-[#d29922]">
            Force push is on: the target branch can be overwritten.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => onConfirm(commitMessage)}>
            Sync now
          </Button>
          <Button onClick={onBack}>Back</Button>
        </div>
      </section>
    );
  }

  if (run.status === 'running') {
    const p = run.progress;
    const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Syncing to {to}</h2>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-[#1f883d] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className={mutedTextClass + ' truncate'}>{p ? `${p.message} (${p.done}/${p.total})` : 'Starting…'}</p>
        <Button className="self-start" onClick={onCancel}>
          Cancel
        </Button>
        <p className={mutedTextClass}>Keep this panel open until it finishes.</p>
      </section>
    );
  }

  if (run.status === 'done') {
    const url = `https://github.com/${plan.target.repo.fullName}/commit/${run.result.commitSha}`;
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-[#1f883d] dark:text-[#3fb950]">Synced</h2>
        <p className="text-sm">
          {plan.engine === 'ref-copy'
            ? `${to} now points at the source commit.`
            : plan.engine === 'git-clone'
              ? `${to} now has the full history of the source branch, ending at ${run.result.commitSha.slice(0, 7)}.`
              : `${run.result.filesChanged} file(s) changed, ${run.result.blobsUploaded} uploaded, in one commit on ${to}.`}
        </p>
        {run.result.pullRequestUrl && (
          <LinkButton
            variant="primary"
            className="text-center"
            href={run.result.pullRequestUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open the pull request
          </LinkButton>
        )}
        <LinkButton
          variant={run.result.pullRequestUrl ? 'secondary' : 'primary'}
          className="text-center"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          View commit {run.result.commitSha.slice(0, 7)}
        </LinkButton>
        <Button className="self-start" onClick={onReset}>
          Done
        </Button>
      </section>
    );
  }

  if (run.status === 'failed') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-[#d1242f] dark:text-[#f85149]">Sync did not finish</h2>
        <p role="alert" className="text-sm">
          {run.message}
        </p>
        <Button className="self-start" onClick={onReset}>
          Back
        </Button>
      </section>
    );
  }

  return null;
}
