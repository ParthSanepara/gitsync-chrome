import { useEffect, useRef, useState } from 'react';
import { describeApiError } from '@/src/errors';
import type { Credential, Repo } from '@/src/providers/types';
import { provider } from '../provider';
import { fieldClass, mutedTextClass } from '../ui';

interface Props {
  credential: Credential;
  onSelect: (repo: Repo) => void;
}

const OWNER_REPO = /^([\w.-]+)\/([\w.-]+)$/;
const SHOWN = 50;
const rowButton =
  'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800';

export function RepoPicker({ credential, onSelect }: Props) {
  const [repos, setRepos] = useState<Repo[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // A dropdown, not an inline list: closes on an outside click rather than on blur, so clicking a row
  // (which blurs the input first) still registers.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const allMatches = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(needle));
  const matches = allMatches.slice(0, SHOWN);
  const typed = OWNER_REPO.exec(query.trim());
  const canLookUp = typed && !matches.some((r) => r.fullName.toLowerCase() === needle);

  function select(repo: Repo) {
    setOpen(false);
    setQuery('');
    onSelect(repo);
  }

  async function lookUp(owner: string, name: string) {
    setError(undefined);
    const res = await provider.getRepo(credential, { owner, name });
    if (res.ok) select(res.value);
    else setError(describeApiError(res.error));
  }

  const showList = open && (matches.length > 0 || canLookUp || !repos || error);

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <input
        className={fieldClass}
        placeholder="Search your repos, or type owner/repo"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {error && !open && (
        <p role="alert" className="text-xs text-[#d1242f] dark:text-[#f85149]">
          {error}
        </p>
      )}
      {showList && (
        <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-[#161b22]">
          {error && (
            <p role="alert" className="px-2.5 py-1.5 text-xs text-[#d1242f] dark:text-[#f85149]">
              {error}
            </p>
          )}
          {!repos && !error && <p className={mutedTextClass + ' px-2.5 py-1.5'}>Loading repositories…</p>}
          {repos && matches.length === 0 && !canLookUp && (
            <p className={mutedTextClass + ' px-2.5 py-1.5'}>No matching repository.</p>
          )}
          <ul className="max-h-64 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-700">
            {matches.map((r) => (
              <li key={r.fullName}>
                <button className={rowButton} onMouseDown={(e) => e.preventDefault()} onClick={() => select(r)}>
                  <span className="truncate font-mono">{r.fullName}</span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {r.private ? 'private' : 'public'}
                    {r.fork ? ' · fork' : ''}
                    {r.archived ? ' · archived' : ''}
                  </span>
                </button>
              </li>
            ))}
            {canLookUp && (
              <li>
                <button
                  className={rowButton}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void lookUp(typed[1] ?? '', typed[2] ?? '')}
                >
                  Use {query.trim()}
                </button>
              </li>
            )}
          </ul>
          {allMatches.length > matches.length && (
            <p className={mutedTextClass + ' border-t border-slate-200 px-2.5 py-1.5 dark:border-slate-700'}>
              Showing {matches.length} of {allMatches.length} — keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
