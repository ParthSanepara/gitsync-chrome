import { useEffect, useState } from 'react';
import { branchNameProblem } from '@/src/gitRefs';
import { describeApiError } from '@/src/errors';
import type { Credential, Ref, Repo } from '@/src/providers/types';
import { provider } from '../provider';

interface Props {
  credential: Credential;
  repo: Repo;
  value: string | undefined;
  onChange: (ref: string) => void;
  /** Target side: allow a branch that does not exist yet (it will be created). */
  allowNew?: boolean;
  /** Where a new target branch's name comes from: the source branch. */
  preferred?: string;
}

const NEW = '__new__';
const field =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800';

/** Mount it with `key={repo.fullName}` so switching repos reloads the list. */
export function BranchSelect({ credential, repo, value, onChange, allowNew, preferred }: Props) {
  const [refs, setRefs] = useState<Ref[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    void provider.listRefs(credential, repo).then((res) => {
      if (!live) return;
      if (res.ok) {
        setRefs(res.value);
        // The target defaults to the source branch's name, whether or not it exists there yet.
        if (!value) onChange(allowNew ? (preferred ?? repo.defaultBranch) : repo.defaultBranch);
      } else setError(describeApiError(res.error));
    });
    return () => {
      live = false;
    };
    // Loads once per mounted repo; the parent remounts this component when the repo changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  if (!refs) return <p className="text-xs text-slate-500">Loading branches…</p>;

  const branches = refs.filter((r) => r.kind === 'branch');
  const tags = allowNew ? [] : refs.filter((r) => r.kind === 'tag');
  const names = new Set(branches.map((b) => b.name));
  const creating = allowNew === true && value !== undefined && !names.has(value);
  const problem = creating ? branchNameProblem(value) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <select
        className={field}
        value={creating ? NEW : (value ?? repo.defaultBranch)}
        aria-label={allowNew ? 'Target branch' : 'Source branch'}
        onChange={(e) => {
          if (e.target.value !== NEW) return onChange(e.target.value);
          onChange(preferred && !names.has(preferred) ? preferred : '');
        }}
      >
        <optgroup label="Branches">
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </optgroup>
        {tags.length > 0 && (
          <optgroup label="Tags">
            {tags.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </optgroup>
        )}
        {allowNew && <option value={NEW}>+ New branch…</option>}
      </select>

      {creating && (
        <>
          <input
            className={field}
            value={value}
            placeholder="new-branch-name"
            aria-label="New branch name"
            onChange={(e) => onChange(e.target.value.trim())}
          />
          {problem ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {problem}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              <code>{value}</code> does not exist in {repo.fullName} yet. It will be created.
            </p>
          )}
        </>
      )}
    </div>
  );
}
