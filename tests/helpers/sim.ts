import { err, ok, type ApiError, type Result } from '@/src/errors';
import type { PlanRequest, SyncPlan } from '@/src/plan';
import { buildPlan } from '@/src/planner';
import type {
  BranchState,
  Commit,
  Credential,
  Repo,
  TreeEntry,
  TreeWrite,
  WritableProvider,
} from '@/src/providers/types';

export const cred: Credential = {
  key: 'github.com:me',
  kind: 'oauth',
  token: 't',
  scopes: ['repo', 'workflow'],
  login: 'me',
};
export const repo = (fullName: string, extra: Partial<Repo> = {}): Repo => {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    owner,
    name,
    fullName,
    private: false,
    fork: false,
    archived: false,
    defaultBranch: 'main',
    canPush: true,
    ...extra,
  };
};

// A tiny content-addressed "git": a blob's sha is derived from its base64 content, so both repos agree on hashes.
export const shaOf = (b64: string) => `H_${b64}`;
export const file = (path: string, text: string): TreeEntry => ({
  path,
  mode: '100644',
  type: 'blob',
  sha: shaOf(btoa(text)),
  size: text.length,
});

export class Sim implements WritableProvider {
  readonly id = 'github' as const;
  readonly host = 'sim';
  log: string[] = [];
  trees: Record<string, TreeEntry[]> = {};
  commits: Record<string, Commit> = {};
  branches: Record<string, BranchState> = {};
  treeWrites: Array<{ entries: TreeWrite[]; base: string | undefined }> = [];
  commitsMade: Array<{ message: string; treeSha: string; parents: string[] }> = [];
  refWrites: Array<{ kind: 'create' | 'update'; branch: string; sha: string; force?: boolean }> = [];
  private n = 0;
  /** A real empty repo answers "empty" for any branch until its first commit. */
  emptyDst = false;
  failCreateBlob: ApiError | undefined;
  failRefWrite: ApiError | undefined;
  failPr: ApiError | undefined;
  reachable = false;
  prs: Array<{ head: string; base: string; title: string; body: string }> = [];
  existingPr: { url: string } | undefined;
  corruptBlobs = false;
  onCreateBlob: (() => void) | undefined;
  rate = undefined;

  addCommit(sha: string, entries: TreeEntry[], parents: string[] = []): string {
    const treeSha = `tree_${sha}`;
    this.trees[treeSha] = entries;
    this.commits[sha] = { sha, treeSha, message: 'm', parents };
    return sha;
  }

  listRepos = async () => ok([]);
  getRepo = async () => err({ code: 'not_found' } as ApiError);
  listRefs = async (_c: Credential, r: { owner: string; name: string }) =>
    ok(
      Object.entries(this.branches)
        .filter(([k, b]) => k.startsWith(`${r.owner}/${r.name}#`) && b.state === 'exists')
        .map(([k, b]) => ({
          name: k.slice(k.indexOf('#') + 1),
          kind: 'branch' as const,
          sha: b.state === 'exists' ? b.sha : '',
        })),
    );
  resolveRef = async (
    _c: Credential,
    r: { owner: string; name: string },
    ref: string,
  ): Promise<Result<Commit, ApiError>> => {
    const branch = this.branches[`${r.owner}/${r.name}#${ref}`];
    const c = this.commits[branch?.state === 'exists' ? branch.sha : ref];
    return c ? ok(c) : err({ code: 'not_found' });
  };
  getBranch = async (_c: Credential, r: { owner: string; name: string }, b: string) => {
    const hasCommits = Object.keys(this.branches).some((k) => k.startsWith('me/dst#'));
    if (this.emptyDst && r.name === 'dst' && !hasCommits) return ok<BranchState>({ state: 'empty-repo' });
    return ok<BranchState>(this.branches[`${r.owner}/${r.name}#${b}`] ?? { state: 'missing' });
  };
  getTree = async (_c: Credential, _r: unknown, sha: string) => {
    this.log.push(`getTree ${sha}`);
    const t = this.trees[sha];
    return t ? ok({ entries: t, truncated: false }) : err({ code: 'not_found' } as ApiError);
  };
  readBlobText = async () => ok('');
  canReachCommit = async () => ok(this.reachable);
  rateLimit = () => this.rate;

  readBlob = async (_c: Credential, _r: unknown, sha: string) => {
    this.log.push(`readBlob ${sha}`);
    return ok(sha.slice(2));
  };
  createBlob = async (_c: Credential, _r: unknown, b64: string): Promise<Result<string, ApiError>> => {
    this.log.push('createBlob');
    this.onCreateBlob?.();
    if (this.failCreateBlob) return err(this.failCreateBlob);
    return ok(this.corruptBlobs ? 'H_corrupt' : shaOf(b64));
  };
  createTree = async (
    _c: Credential,
    _r: unknown,
    entries: TreeWrite[],
    base?: string,
  ): Promise<Result<string, ApiError>> => {
    this.log.push('createTree');
    this.treeWrites.push({ entries, base });
    const map = new Map((base ? (this.trees[base] ?? []) : []).map((e) => [e.path, e]));
    for (const w of entries) {
      if (w.sha === null) map.delete(w.path);
      else map.set(w.path, { path: w.path, mode: w.mode, type: w.type, sha: w.sha });
    }
    const id = `newtree_${++this.n}`;
    this.trees[id] = [...map.values()];
    return ok(id);
  };
  createCommit = async (
    _c: Credential,
    _r: unknown,
    c: { message: string; treeSha: string; parents: string[] },
  ): Promise<Result<string, ApiError>> => {
    this.log.push('createCommit');
    this.commitsMade.push(c);
    const sha = `newcommit_${++this.n}`;
    this.commits[sha] = { sha, treeSha: c.treeSha, message: c.message, parents: c.parents };
    return ok(sha);
  };
  createRef = async (
    _c: Credential,
    r: { owner: string; name: string },
    branch: string,
    sha: string,
  ): Promise<Result<void, ApiError>> => {
    this.log.push('createRef');
    if (this.failRefWrite) return err(this.failRefWrite);
    this.refWrites.push({ kind: 'create', branch, sha });
    this.branches[`${r.owner}/${r.name}#${branch}`] = { state: 'exists', sha };
    return ok(undefined);
  };
  updateRef = async (
    _c: Credential,
    r: { owner: string; name: string },
    branch: string,
    sha: string,
    force: boolean,
  ): Promise<Result<void, ApiError>> => {
    this.log.push('updateRef');
    if (this.failRefWrite) return err(this.failRefWrite);
    this.refWrites.push({ kind: 'update', branch, sha, force });
    this.branches[`${r.owner}/${r.name}#${branch}`] = { state: 'exists', sha };
    return ok(undefined);
  };
  createFirstFile = async (
    _c: Credential,
    r: { owner: string; name: string },
    f: { path: string; base64: string; message: string },
  ): Promise<Result<{ commitSha: string; treeSha: string }, ApiError>> => {
    this.log.push(`createFirstFile ${f.path}`);
    const sha = this.addCommit(`first_${++this.n}`, [
      { path: f.path, mode: '100644', type: 'blob', sha: shaOf(f.base64) },
    ]);
    this.branches[`${r.owner}/${r.name}#main`] = { state: 'exists', sha };
    return ok({ commitSha: sha, treeSha: `tree_${sha}` });
  };

  openPullRequest = async (
    _c: Credential,
    _r: unknown,
    pr: { title: string; body: string; head: string; base: string },
  ): Promise<Result<{ url: string }, ApiError>> => {
    this.log.push('openPullRequest');
    if (this.failPr) return err(this.failPr);
    this.prs.push(pr);
    return ok({ url: `https://github.com/me/dst/pull/${this.prs.length}` });
  };
  findOpenPullRequest = async (): Promise<Result<{ url: string } | undefined, ApiError>> => ok(this.existingPr);

  targetTreeOf(branch = 'main'): TreeEntry[] {
    const b = this.branches[`me/dst#${branch}`];
    if (!b || b.state !== 'exists') return [];
    return this.trees[this.commits[b.sha]?.treeSha ?? ''] ?? [];
  }
}

export const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  source: { repo: repo('me/src'), ref: 'main' },
  target: { repo: repo('me/dst'), branch: 'main' },
  mode: 'snapshot',
  write: 'push',
  credentials: { source: cred, target: cred },
  ...over,
});

export const byPath = (entries: TreeEntry[]) => Object.fromEntries(entries.map((e) => [e.path, e.sha]));

export function scenario(opts: { target?: 'exists' | 'missing' | 'empty'; sourceFiles?: TreeEntry[] } = {}) {
  const sim = new Sim();
  sim.addCommit('src1', opts.sourceFiles ?? [file('a.txt', 'A'), file('b.txt', 'B2'), file('dir/new.txt', 'N')]);
  sim.branches['me/src#main'] = { state: 'exists', sha: 'src1' };
  if ((opts.target ?? 'exists') === 'exists') {
    sim.addCommit('tgt1', [file('a.txt', 'A'), file('b.txt', 'B1'), file('gone.txt', 'G')]);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt1' };
  } else if (opts.target === 'empty') {
    sim.emptyDst = true;
  }
  return sim;
}

export async function planFor(sim: Sim, req = request()): Promise<SyncPlan> {
  const res = await buildPlan(sim, req);
  if (!res.ok) throw new Error(`plan failed: ${res.error.code}`);
  return res.value;
}
