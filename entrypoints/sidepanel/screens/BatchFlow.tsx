import { useRef, useState } from 'react';
import {
  MAX_BATCH_BRANCHES,
  planBatch,
  runBatch,
  type BatchEvent,
  type BatchItem,
  type BatchOutcome,
  type BatchRequest,
} from '@/src/batch';
import { describeBatchError, describePlanBlocker } from '@/src/errors';
import type { HistoryMode } from '@/src/plan';
import type { Credential, Repo } from '@/src/providers/types';
import { provider } from '../provider';
import { Button, dividedListClass, mutedTextClass, textLinkClass } from '../ui';

type Phase = 'idle' | 'planning' | 'preview' | 'confirm' | 'running' | 'done';

function describeItem(item: BatchItem): { label: string; tone: 'ok' | 'muted' | 'bad'; selectable: boolean } {
  if (item.error) return { label: `Could not plan: ${item.error}`, tone: 'bad', selectable: false };
  const plan = item.plan;
  if (!plan) return { label: 'Not planned', tone: 'bad', selectable: false };
  const blockers = plan.blockers;
  if (blockers.length > 0 && blockers.every((b) => b.code === 'already_in_sync')) {
    return { label: 'Up to date', tone: 'muted', selectable: false };
  }
  if (blockers.length > 0)
    return {
      label: `Blocked: ${describePlanBlocker(blockers[0] as (typeof blockers)[number])}`,
      tone: 'bad',
      selectable: false,
    };
  if (plan.engine === 'ref-copy')
    return {
      label: plan.target.exists ? 'Update (full history)' : 'New branch (full history)',
      tone: 'ok',
      selectable: true,
    };
  return {
    label: `${plan.target.exists ? 'Update' : 'New branch'} · ${plan.estimate.filesChanged} file(s)`,
    tone: 'ok',
    selectable: true,
  };
}

function describeOutcome(o: BatchOutcome | undefined): string {
  if (!o) return 'Waiting';
  switch (o.status) {
    case 'synced':
      return 'Synced';
    case 'up-to-date':
      return 'Up to date';
    case 'skipped':
      return `Skipped: ${o.reasons[0] ?? ''}`;
    case 'failed':
      return `Failed: ${o.message}`;
    case 'not-run':
      return 'Not run';
  }
}

export function BatchFlow({
  credential,
  source,
  target,
  mode,
  write,
}: {
  credential: Credential;
  source: Repo;
  target: Repo;
  mode: HistoryMode;
  write: 'push' | 'force-push';
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>();
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [current, setCurrent] = useState<string | undefined>();
  const [detail, setDetail] = useState<string | undefined>();
  const [outcomes, setOutcomes] = useState<Record<string, BatchOutcome>>({});
  const abort = useRef<AbortController | null>(null);

  const request: BatchRequest = {
    source: { repo: source },
    target: { repo: target },
    mode,
    write,
    credentials: { source: credential, target: credential },
  };

  async function preview() {
    const controller = new AbortController();
    abort.current = controller;
    setPhase('planning');
    setError(undefined);
    setProgress({ done: 0, total: 0 });
    const res = await planBatch(provider, request, (done, total) => setProgress({ done, total }), controller.signal);
    if (!res.ok) {
      setError(res.error.code === 'cancelled' ? 'Cancelled.' : describeBatchError(res.error));
      setPhase('idle');
      return;
    }
    setItems(res.value);
    setSelected(new Set(res.value.filter((i) => describeItem(i).selectable).map((i) => i.branch)));
    setPhase('preview');
  }

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    const branches = items.filter((i) => selected.has(i.branch)).map((i) => i.branch);
    setOutcomes({});
    setPhase('running');
    const onEvent = (e: BatchEvent) => {
      if (e.type === 'start') {
        setCurrent(e.branch);
        setDetail(undefined);
      } else if (e.type === 'progress') setDetail(`${e.progress.message} (${e.progress.done}/${e.progress.total})`);
      else setOutcomes((prev) => ({ ...prev, [e.branch]: e.outcome }));
    };
    await runBatch(provider, request, branches, onEvent, controller.signal);
    setCurrent(undefined);
    setPhase('done');
  }

  const toggle = (branch: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });

  if (phase === 'idle') {
    return (
      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="text-sm text-[#d1242f] dark:text-[#f85149]">
            {error}
          </p>
        )}
        <Button variant="primary" onClick={() => void preview()}>
          Preview all branches
        </Button>
        <p className={mutedTextClass}>
          Lists every branch of {source.fullName} (up to {MAX_BATCH_BRANCHES}) and checks each against {target.fullName}
          . Tags are not included, and branches that exist only in the target are never deleted.
        </p>
      </div>
    );
  }

  if (phase === 'planning') {
    const p = progress;
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="text-sm">
          {p && p.total > 0 ? `Checking branch ${Math.min(p.done + 1, p.total)} of ${p.total}…` : 'Listing branches…'}
        </p>
        <Button className="self-start" onClick={() => abort.current?.abort()}>
          Cancel
        </Button>
      </div>
    );
  }

  if (phase === 'running' || phase === 'done') {
    const ran = items.filter((i) => selected.has(i.branch));
    const synced = Object.values(outcomes).filter((o) => o.status === 'synced').length;
    const failed = Object.values(outcomes).filter((o) => o.status === 'failed').length;
    return (
      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {phase === 'running'
            ? `Syncing ${source.fullName} → ${target.fullName}`
            : `Finished: ${synced} synced, ${failed} failed`}
        </h2>
        <ul className={dividedListClass + ' text-sm'}>
          {ran.map((i) => (
            <li key={i.branch} className="flex flex-col gap-0.5 px-2.5 py-1.5">
              <span className="truncate font-mono font-medium">{i.branch}</span>
              <span className={mutedTextClass}>
                {outcomes[i.branch]
                  ? describeOutcome(outcomes[i.branch])
                  : current === i.branch
                    ? (detail ?? 'Working…')
                    : 'Waiting'}
              </span>
            </li>
          ))}
        </ul>
        {phase === 'running' ? (
          <>
            <Button className="self-start" onClick={() => abort.current?.abort()}>
              Cancel after this branch
            </Button>
            <p className={mutedTextClass}>Keep this panel open until it finishes.</p>
          </>
        ) : (
          <Button className="self-start" onClick={() => setPhase('idle')}>
            Done
          </Button>
        )}
      </section>
    );
  }

  const counts = {
    create: items.filter((i) => i.plan && i.plan.blockers.length === 0 && !i.plan.target.exists).length,
    update: items.filter((i) => i.plan && i.plan.blockers.length === 0 && i.plan.target.exists).length,
    same: items.filter((i) => describeItem(i).label === 'Up to date').length,
    blocked: items.filter((i) => describeItem(i).tone === 'bad').length,
  };
  const chosen = selected.size;

  if (phase === 'confirm') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Confirm</h2>
        <p className="text-sm">
          This syncs {chosen} branch(es) of <strong>{source.fullName}</strong> into <strong>{target.fullName}</strong>,
          one at a time. Missing branches are created; existing ones get a new commit.
        </p>
        {write === 'force-push' && (
          <p className="text-sm text-[#9a6700] dark:text-[#d29922]">
            Force push is on: diverged branches can be overwritten.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void start()}>
            Sync {chosen} branch(es)
          </Button>
          <Button onClick={() => setPhase('preview')}>Back</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Repository sync preview">
      <p className="text-sm">
        {items.length} branch(es): {counts.create} new, {counts.update} to update, {counts.same} up to date,{' '}
        {counts.blocked} blocked.
      </p>
      <div className="flex gap-3">
        <button
          className={textLinkClass}
          onClick={() => setSelected(new Set(items.filter((i) => describeItem(i).selectable).map((i) => i.branch)))}
        >
          Select all
        </button>
        <button className={textLinkClass} onClick={() => setSelected(new Set())}>
          Select none
        </button>
      </div>
      <ul className={dividedListClass}>
        {items.map((i) => {
          const d = describeItem(i);
          return (
            <li key={i.branch}>
              <label
                className={`flex items-start gap-2 px-2.5 py-1.5 text-sm ${d.selectable ? 'cursor-pointer' : 'opacity-70'}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!d.selectable}
                  checked={selected.has(i.branch)}
                  onChange={() => toggle(i.branch)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono font-medium">{i.branch}</span>
                  <span
                    className={`block text-xs ${d.tone === 'bad' ? 'text-[#d1242f] dark:text-[#f85149]' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {d.label}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button variant="primary" disabled={chosen === 0} onClick={() => setPhase('confirm')}>
        {chosen === 0 ? 'Select at least one branch' : `Sync ${chosen} branch(es)`}
      </Button>
    </section>
  );
}
