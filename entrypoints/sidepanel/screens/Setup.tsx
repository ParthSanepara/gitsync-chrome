import { useState } from 'react';
import type { Credential, Repo } from '@/src/providers/types';
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

export function Setup({ credential }: { credential: Credential }) {
  const [source, setSource] = useState<Side>({});
  const [target, setTarget] = useState<Side>({});
  const problem = targetProblem(source, target);
  const ready = source.repo && source.ref && target.repo && target.ref && !problem;

  return (
    <div className="flex flex-col gap-5">
      <SidePicker title="Source" credential={credential} side={source} onChange={setSource} />
      <SidePicker title="Target" credential={credential} side={target} onChange={setTarget} />
      {problem && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
      <button
        disabled={!ready}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        Preview sync
      </button>
      <p className="text-xs text-slate-500">Preview and sync arrive in the next step.</p>
    </div>
  );
}
