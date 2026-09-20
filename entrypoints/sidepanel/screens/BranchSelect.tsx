import { useEffect, useState } from 'react';
import { describeApiError } from '@/src/errors';
import type { Credential, Ref, Repo } from '@/src/providers/types';
import { provider } from '../provider';

interface Props {
  credential: Credential;
  repo: Repo;
  value: string | undefined;
  onChange: (ref: string) => void;
}

/** Mount it with `key={repo.fullName}` so switching repos reloads the list. */
export function BranchSelect({ credential, repo, value, onChange }: Props) {
  const [refs, setRefs] = useState<Ref[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    void provider.listRefs(credential, repo).then((res) => {
      if (!live) return;
      if (res.ok) {
        setRefs(res.value);
        if (!value) onChange(repo.defaultBranch);
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
  const tags = refs.filter((r) => r.kind === 'tag');
  return (
    <select
      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
      value={value ?? repo.defaultBranch}
      onChange={(e) => onChange(e.target.value)}
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
    </select>
  );
}
