import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { describeApiError, describeSyncError } from '@/src/errors';
import { branchNameProblem } from '@/src/gitRefs';
import type { HistoryMode, SyncPlan, WriteMode } from '@/src/plan';
import { buildPlan } from '@/src/planner';
import type { Credential, Repo } from '@/src/providers/types';
import { parseGitHubRepoUrl } from '@/src/providers/github/repoUrl';
import { runSync } from '@/src/runner';
import { provider } from '../provider';
import { Button, textLinkClass } from '../ui';
import { BatchFlow } from './BatchFlow';
import { BranchSelect } from './BranchSelect';
import { ChoiceGroup } from './ChoiceGroup';
import { PlanView } from './PlanView';
import { RepoPicker } from './RepoPicker';
import { RunPanel, type RunState } from './RunPanel';

type Scope = 'branch' | 'repo';

interface Side {
  repo?: Repo;
  ref?: string;
}

function SidePicker({
  title,
  credential,
  side,
  onChange,
  withBranch,
  allowNew,
  preferred,
}: {
  title: string;
  credential: Credential;
  side: Side;
  onChange: (side: Side) => void;
  withBranch: boolean;
  allowNew?: boolean;
  preferred?: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {side.repo ? (
        <>
          <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-[#161b22]">
            <span className="truncate font-mono font-medium">{side.repo.fullName}</span>
            <button className={textLinkClass + ' shrink-0'} onClick={() => onChange({})}>
              Change
            </button>
          </div>
          {withBranch && (
            <>
              <BranchSelect
                key={side.repo.fullName}
                credential={credential}
                repo={side.repo}
                value={side.ref}
                allowNew={allowNew}
                preferred={preferred}
                onChange={(ref) => onChange({ ...side, ref })}
              />
              {allowNew && preferred && side.ref !== preferred && (
                <button className={textLinkClass + ' self-start'} onClick={() => onChange({ ...side, ref: preferred })}>
                  Use the source branch name ({preferred})
                </button>
              )}
            </>
          )}
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
  if (target.ref !== undefined && target.ref !== '') return branchNameProblem(target.ref);
  return undefined;
}

export function Setup({ credential, onGrantWorkflow }: { credential: Credential; onGrantWorkflow: () => void }) {
  const [scope, setScopeRaw] = useState<Scope>('branch');
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
  const setScope = edited((v: Scope) => {
    setScopeRaw(v);
    // Pull requests are one branch at a time.
    if (v === 'repo' && write === 'pull-request') setWriteRaw('push');
  });

  // Fast-forward: if the tab open when the panel was invoked is a GitHub repo, offer it as the source.
  // Never overwrites a repo the user already picked, including one picked while this was in flight.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const parsed = tab?.url ? parseGitHubRepoUrl(tab.url) : undefined;
      if (!parsed || !live) return;
      const res = await provider.getRepo(credential, parsed);
      if (!live || !res.ok) return;
      setSourceRaw((prev) => (prev.repo ? prev : { repo: res.value }));
    })();
    return () => {
      live = false;
    };
    // Runs once, off the tab active when the panel opened — not a response to later input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A plan made with different permissions is stale.
  const plan = planned && planned.scopes === credential.scopes.join(',') ? planned.plan : undefined;
  const problem = targetProblem(source, target);
  const bothRepos = Boolean(source.repo && target.repo);
  const ready = scope === 'repo' ? bothRepos && !problem : bothRepos && source.ref && target.ref && !problem;

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

  async function startRun(commitMessage?: string) {
    if (!plan) return;
    const controller = new AbortController();
    abort.current = controller;
    setRun({ status: 'running' });
    const res = await runSync(
      provider,
      commitMessage !== undefined ? { ...plan, commitMessage } : plan,
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

  if (scope === 'branch' && plan && run.status !== 'idle') {
    return (
      <RunPanel
        plan={plan}
        run={run}
        onConfirm={(commitMessage) => void startRun(commitMessage)}
        onCancel={() => abort.current?.abort()}
        onBack={() => setRun({ status: 'idle' })}
        onReset={resetRun}
      />
    );
  }

  const repoFlow = scope === 'repo' && source.repo && target.repo;

  return (
    <div className="flex flex-col gap-4">
      <ChoiceGroup
        legend="What to sync"
        name="scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'branch', label: 'One branch' },
          {
            value: 'repo',
            label: 'Entire repository',
            hint: 'Every branch, into the same-named branch (created if missing).',
          },
        ]}
      />

      <SidePicker
        title="Source"
        credential={credential}
        side={source}
        onChange={setSource}
        withBranch={scope === 'branch'}
      />
      <SidePicker
        title="Target"
        credential={credential}
        side={target}
        onChange={setTarget}
        withBranch={scope === 'branch'}
        allowNew
        preferred={source.ref}
      />

      <ChoiceGroup
        legend="History"
        name="history"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'snapshot',
            label: 'Latest commit only',
            hint: 'One new commit with the source files. Works between any two repositories.',
          },
          {
            value: 'full',
            label: 'Full history',
            hint: 'Keeps every commit. Instant when the target is a fork of the source; otherwise a real clone and push, which takes longer.',
          },
        ]}
      />

      <ChoiceGroup
        legend="How to write"
        name="write"
        value={write}
        onChange={setWrite}
        options={[
          { value: 'push', label: 'Push to the target branch' },
          { value: 'force-push', label: 'Force push', hint: 'Overwrites the target branch if it has diverged.' },
          {
            value: 'pull-request',
            label: 'Open a pull request',
            hint:
              scope === 'repo'
                ? 'One branch at a time only.'
                : 'Syncs to a gitsync/ branch and opens a PR into the target branch. Use this for protected branches.',
            disabled: scope === 'repo',
          },
        ]}
      />

      {problem && (
        <p role="alert" className="text-sm text-[#d1242f] dark:text-[#f85149]">
          {problem}
        </p>
      )}

      {repoFlow ? (
        <BatchFlow
          key={`${source.repo?.fullName}>${target.repo?.fullName}|${mode}|${write}`}
          credential={credential}
          source={source.repo as Repo}
          target={target.repo as Repo}
          mode={mode}
          write={write === 'force-push' ? 'force-push' : 'push'}
        />
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm text-[#d1242f] dark:text-[#f85149]">
              {error}
            </p>
          )}
          <Button variant="primary" disabled={!ready || planning} onClick={() => void preview()}>
            {planning ? 'Planning…' : 'Preview sync'}
          </Button>
          {plan && (
            <PlanView plan={plan} onGrantWorkflow={onGrantWorkflow} onRun={() => setRun({ status: 'confirm' })} />
          )}
        </>
      )}
    </div>
  );
}
