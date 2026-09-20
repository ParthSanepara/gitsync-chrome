import { useRef, useState } from 'react';
import { describeApiError, describeSyncError } from '@/src/errors';
import type { HistoryMode, SyncPlan, WriteMode } from '@/src/plan';
import { buildPlan } from '@/src/planner';
import { runSync } from '@/src/runner';
import type { Credential, Repo } from '@/src/providers/types';
import { provider } from '../provider';
import { PlanView } from './PlanView';
import { RunPanel, type RunState } from './RunPanel';
import { BranchSelect } from './BranchSelect';
import { RepoPicker } from './RepoPicker';

interface Side {
  repo?: Repo;
  ref?: string;
}

const linkButton =
  'text-xs text-slate-600 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100';

function SidePicker({
  title,
  credential,
  side,
  onChange,
}: {
  title: string;
  credential: Credential;
  side: Side;
  onChange: (side: Side) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {side.repo ? (
        <>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">{side.repo.fullName}</span>
            <button className={linkButton} onClick={() => onChange({})}>
              Change
            </button>
          </div>
          <BranchSelect
            key={side.repo.fullName}
            credential={credential}
            repo={side.repo}
            value={side.ref}
            onChange={(ref) => onChange({ ...side, ref })}
          />
        </>
      ) : (
        <RepoPicker credential={credential} onSelect={(repo) => onChange({ repo })} />
      )}
    </section>
  );
}

function targetProblem(source: Side, target: Side): string | undefined {
  const t = target.repo;
  if (!t) return undefined;
  if (t.archived) return 'This repository is archived, so it is read-only.';
  if (t.canPush === false) return 'Your account does not have write access to this repository.';
  if (source.repo && source.repo.fullName === t.fullName && source.ref === target.ref) {
    return 'Source and target are the same branch.';
  }
  return undefined;
}

const select =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800';

export function Setup({ credential, onGrantWorkflow }: { credential: Credential; onGrantWorkflow: () => void }) {
  const [source, setSourceRaw] = useState<Side>({});
  const [target, setTargetRaw] = useState<Side>({});
  const [mode, setModeRaw] = useState<HistoryMode>('snapshot');
  const [write, setWriteRaw] = useState<WriteMode>('push');
  const [planned, setPlan] = useState<{ plan: SyncPlan; scopes: string } | undefined>();
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // Any change to the inputs invalidates the plan that was shown.
  const edited =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPlan(undefined);
      setError(undefined);
    };
  const setSource = edited(setSourceRaw);
  const setTarget = edited(setTargetRaw);
  const setMode = edited(setModeRaw);
  const setWrite = edited(setWriteRaw);

  // A plan made with different permissions is stale (e.g. right after granting `workflow`).
  const plan = planned && planned.scopes === credential.scopes.join(',') ? planned.plan : undefined;
  const problem = targetProblem(source, target);
  const ready = source.repo && source.ref && target.repo && target.ref && !problem;

  async function preview() {
    if (!source.repo || !source.ref || !target.repo || !target.ref) return;
    setPlanning(true);
    setError(undefined);
    const res = await buildPlan(provider, {
      source: { repo: source.repo, ref: source.ref },
      target: { repo: target.repo, branch: target.ref },
      mode,
      write,
      credentials: { source: credential, target: credential },
    });
    setPlanning(false);
    if (res.ok) setPlan({ plan: res.value, scopes: credential.scopes.join(',') });
    else setError(describeApiError(res.error));
  }

  async function startRun() {
    if (!plan) return;
    const controller = new AbortController();
    abort.current = controller;
    setRun({ status: 'running' });
    const res = await runSync(
      provider,
      plan,
      { source: credential, target: credential },
      (progress) => setRun((prev) => (prev.status === 'running' ? { status: 'running', progress } : prev)),
      controller.signal,
    );
    if (res.ok) setRun({ status: 'done', result: res.value });
    else if (res.error.code === 'cancelled')
      setRun({ status: 'failed', message: 'Cancelled. The target branch was not changed.' });
    else setRun({ status: 'failed', message: describeSyncError(res.error) });
  }

  // The target moved (or may have), so the old preview no longer describes it.
  function resetRun() {
    setRun({ status: 'idle' });
    setPlan(undefined);
  }

  if (plan && run.status !== 'idle') {
    return (
      <RunPanel
        plan={plan}
        run={run}
        onConfirm={() => void startRun()}
        onCancel={() => abort.current?.abort()}
        onBack={() => setRun({ status: 'idle' })}
        onReset={resetRun}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SidePicker title="Source" credential={credential} side={source} onChange={setSource} />
      <SidePicker title="Target" credential={credential} side={target} onChange={setTarget} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What to copy</h2>
        <select
          className={select}
          value={mode}
          onChange={(e) => setMode(e.target.value as HistoryMode)}
          aria-label="History"
        >
          <option value="snapshot">Latest commit only</option>
          <option value="full">Full history</option>
        </select>
        <select
          className={select}
          value={write}
          onChange={(e) => setWrite(e.target.value as WriteMode)}
          aria-label="Write mode"
        >
          <option value="push">Push to the target branch</option>
          <option value="force-push">Force push (overwrite the target branch)</option>
        </select>
      </section>

      {problem && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        disabled={!ready || planning}
        onClick={() => void preview()}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        {planning ? 'Planning…' : 'Preview sync'}
      </button>
      {plan && <PlanView plan={plan} onGrantWorkflow={onGrantWorkflow} onRun={() => setRun({ status: 'confirm' })} />}
    </div>
  );
}
