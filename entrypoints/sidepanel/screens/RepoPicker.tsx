import { useEffect, useState } from 'react';
import { describeApiError } from '@/src/errors';
import type { Credential, Repo } from '@/src/providers/types';
import { provider } from '../provider';

interface Props {
  credential: Credential;
  onSelect: (repo: Repo) => void;
}

const OWNER_REPO = /^([\w.-]+)\/([\w.-]+)$/;
const rowButton =
  'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800';

export function RepoPicker({ credential, onSelect }: Props) {
  const [repos, setRepos] = useState<Repo[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    void provider.listRepos(credential, '').then((res) => {
      if (!live) return;
      if (res.ok) setRepos(res.value);
      else setError(describeApiError(res.error));
    });
    return () => {
      live = false;
    };
  }, [credential]);

  const needle = query.trim().toLowerCase();
  const matches = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(needle)).slice(0, 8);
  const typed = OWNER_REPO.exec(query.trim());
  const canLookUp = typed && !matches.some((r) => r.fullName.toLowerCase() === needle);

  async function lookUp(owner: string, name: string) {
    setError(undefined);
    const res = await provider.getRepo(credential, { owner, name });
    if (res.ok) onSelect(res.value);
    else setError(describeApiError(res.error));
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        placeholder="Search your repos, or type owner/repo"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!repos && !error && <p className="text-xs text-slate-500">Loading repositories…</p>}
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {matches.map((r) => (
          <li key={r.fullName}>
            <button className={rowButton} onClick={() => onSelect(r)}>
              <span className="truncate">{r.fullName}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {r.private ? 'private' : 'public'}
                {r.fork ? ' · fork' : ''}
                {r.archived ? ' · archived' : ''}
              </span>
            </button>
          </li>
        ))}
        {canLookUp && (
          <li>
            <button className={rowButton} onClick={() => void lookUp(typed[1] ?? '', typed[2] ?? '')}>
              Use {query.trim()}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
