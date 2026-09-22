import { useEffect, useId, useMemo, useState } from 'react';
import { branchNameProblem } from '@/src/gitRefs';
import { describeApiError } from '@/src/errors';
import type { Credential, Ref, Repo } from '@/src/providers/types';
import { provider } from '../provider';
import { fieldClass, mutedTextClass } from '../ui';

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

/** Rendering thousands of rows makes the list sluggish; typing narrows it instead. */
const MAX_SHOWN = 50;

interface Option {
  name: string;
  kind: Ref['kind'] | 'new';
}

/** Default branch first. With a query: exact match, then prefix matches, then substring matches. */
function rank(refs: Ref[], defaultBranch: string, query: string): Ref[] {
  const q = query.trim().toLowerCase();
  const score = (r: Ref) => {
    const n = r.name.toLowerCase();
    if (!q) return r.kind === 'branch' && r.name === defaultBranch ? 0 : 1;
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  };
  return refs
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.r);
}

/** Mount it with `key={repo.fullName}` so switching repos reloads the list. */
export function BranchSelect({ credential, repo, value, onChange, allowNew, preferred }: Props) {
  const [refs, setRefs] = useState<Ref[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

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

  const pickable = useMemo(() => (refs ?? []).filter((r) => r.kind === 'branch' || !allowNew), [refs, allowNew]);
  const names = useMemo(() => new Set(pickable.filter((r) => r.kind === 'branch').map((r) => r.name)), [pickable]);

  const matches = useMemo(() => rank(pickable, repo.defaultBranch, query), [pickable, repo.defaultBranch, query]);
  const typed = query.trim();
  const offerNew = allowNew === true && typed !== '' && !names.has(typed);
  const options: Option[] = [
    ...matches.slice(0, MAX_SHOWN).map((r) => ({ name: r.name, kind: r.kind })),
    ...(offerNew ? [{ name: typed, kind: 'new' as const }] : []),
  ];

  if (error) {
    return (
      <p role="alert" className="text-xs text-[#d1242f] dark:text-[#f85149]">
        {error}
      </p>
    );
  }
  if (!refs) return <p className={mutedTextClass}>Loading branches…</p>;

  const creating = allowNew === true && value !== undefined && value !== '' && !names.has(value);
  const problem = creating ? branchNameProblem(value) : undefined;
  const newProblem = offerNew ? branchNameProblem(typed) : undefined;

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const pick = (o: Option | undefined) => {
    if (!o || (o.kind === 'new' && newProblem)) return;
    onChange(o.name);
    close();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          className={fieldClass + ' pr-16 font-mono'}
          role="combobox"
          aria-label={allowNew ? 'Target branch' : 'Source branch'}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={open ? query : (value ?? '')}
          placeholder={allowNew ? 'Find or create a branch…' : 'Find a branch or tag…'}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={close}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === 'Escape') {
              close();
            }
          }}
        />
        {!open && value === repo.defaultBranch && (
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-full border border-slate-300 px-1.5 text-[11px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
            default
          </span>
        )}

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg dark:border-slate-600 dark:bg-[#161b22]"
          >
            {options.map((o, i) => (
              <li
                key={`${o.kind}:${o.name}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.kind !== 'new' && o.name === value}
                aria-disabled={o.kind === 'new' && newProblem !== undefined}
                className={[
                  'flex cursor-pointer items-center gap-2 px-2.5 py-1.5',
                  i === active ? 'bg-slate-100 dark:bg-slate-700/60' : '',
                  o.kind === 'new' && newProblem ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
                // mousedown, not click: keeps focus in the input so its blur does not close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="w-3 shrink-0 text-[#0969da] dark:text-[#4493f8]">
                  {o.kind !== 'new' && o.name === value ? '✓' : ''}
                </span>
                {o.kind === 'new' ? (
                  <span className="truncate">
                    Create branch <code className="font-mono">{o.name}</code>
                  </span>
                ) : (
                  <span className="truncate font-mono">{o.name}</span>
                )}
                {o.kind === 'branch' && o.name === repo.defaultBranch && (
                  <span className="ml-auto shrink-0 rounded-full border border-slate-300 px-1.5 text-[11px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    default
                  </span>
                )}
                {o.kind === 'tag' && <span className={mutedTextClass + ' ml-auto shrink-0'}>tag</span>}
              </li>
            ))}
            {options.length === 0 && (
              <li className={mutedTextClass + ' px-2.5 py-1.5'}>No branch or tag matches “{typed}”.</li>
            )}
            {matches.length > MAX_SHOWN && (
              <li className={mutedTextClass + ' border-t border-slate-200 px-2.5 py-1.5 dark:border-slate-700'}>
                Showing {MAX_SHOWN} of {matches.length}. Type to narrow the list.
              </li>
            )}
            {offerNew && newProblem && (
              <li role="alert" className="px-2.5 py-1.5 text-xs text-[#d1242f] dark:text-[#f85149]">
                {newProblem}
              </li>
            )}
          </ul>
        )}
      </div>

      {!open &&
        creating &&
        (problem ? (
          <p role="alert" className="text-xs text-[#d1242f] dark:text-[#f85149]">
            {problem}
          </p>
        ) : (
          <p className={mutedTextClass}>
            <code>{value}</code> does not exist in {repo.fullName} yet. It will be created.
          </p>
        ))}
      {!open && (
        <p className={mutedTextClass}>
          {names.size} {names.size === 1 ? 'branch' : 'branches'}. Click the field and type to search.
        </p>
      )}
    </div>
  );
}
