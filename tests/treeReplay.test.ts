import { describe, expect, it } from 'vitest';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import { treeReplay } from '@/src/engines/treeReplay';
import type { Progress } from '@/src/engines/types';
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

const cred: Credential = { key: 'github.com:me', kind: 'oauth', token: 't', scopes: ['repo', 'workflow'], login: 'me' };
const repo = (fullName: string, extra: Partial<Repo> = {}): Repo => {
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
const shaOf = (b64: string) => `H_${b64}`;
const file = (path: string, text: string): TreeEntry => ({
  path,
  mode: '100644',
  type: 'blob',
  sha: shaOf(btoa(text)),
  size: text.length,
});

class Sim implements WritableProvider {
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
  failCreateBlob: ApiError | undefined;
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
  listRefs = async () => ok([]);
  resolveRef = async (
    _c: Credential,
    r: { owner: string; name: string },
    ref: string,
  ): Promise<Result<Commit, ApiError>> => {
    const branch = this.branches[`${r.owner}/${r.name}#${ref}`];
    const c = this.commits[branch?.state === 'exists' ? branch.sha : ref];
    return c ? ok(c) : err({ code: 'not_found' });
  };
  getBranch = async (_c: Credential, r: { owner: string; name: string }, b: string) =>
    ok<BranchState>(this.branches[`${r.owner}/${r.name}#${b}`] ?? { state: 'missing' });
  getTree = async (_c: Credential, _r: unknown, sha: string) => {
    this.log.push(`getTree ${sha}`);
    const t = this.trees[sha];
    return t ? ok({ entries: t, truncated: false }) : err({ code: 'not_found' } as ApiError);
  };
  readBlobText = async () => ok('');
  canReachCommit = async () => ok(false);
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

  targetTreeOf(branch = 'main'): TreeEntry[] {
    const b = this.branches[`me/dst#${branch}`];
    if (!b || b.state !== 'exists') return [];
    return this.trees[this.commits[b.sha]?.treeSha ?? ''] ?? [];
  }
}

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  source: { repo: repo('me/src'), ref: 'main' },
  target: { repo: repo('me/dst'), branch: 'main' },
  mode: 'snapshot',
  write: 'push',
  credentials: { source: cred, target: cred },
  ...over,
});

const byPath = (entries: TreeEntry[]) => Object.fromEntries(entries.map((e) => [e.path, e.sha]));

function scenario(opts: { target?: 'exists' | 'missing' | 'empty'; sourceFiles?: TreeEntry[] } = {}) {
  const sim = new Sim();
  sim.addCommit('src1', opts.sourceFiles ?? [file('a.txt', 'A'), file('b.txt', 'B2'), file('dir/new.txt', 'N')]);
  sim.branches['me/src#main'] = { state: 'exists', sha: 'src1' };
  if ((opts.target ?? 'exists') === 'exists') {
    sim.addCommit('tgt1', [file('a.txt', 'A'), file('b.txt', 'B1'), file('gone.txt', 'G')]);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt1' };
  } else if (opts.target === 'empty') {
    sim.branches['me/dst#main'] = { state: 'empty-repo' };
  }
  return sim;
}

async function planFor(sim: Sim, req = request()): Promise<SyncPlan> {
  const res = await buildPlan(sim, req);
  if (!res.ok) throw new Error(`plan failed: ${res.error.code}`);
  return res.value;
}

const run = (sim: Sim, plan: SyncPlan, signal = new AbortController().signal, progress: Progress[] = []) =>
  treeReplay.execute(sim, plan, { source: cred, target: cred }, (p) => progress.push(p), signal);

describe('treeReplay.execute', () => {
  it('makes the target tree equal to the source tree, uploading only what changed', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    const progress: Progress[] = [];
    const res = await run(sim, plan, undefined, progress);

    expect(res).toMatchObject({ ok: true, value: { filesChanged: 3, blobsUploaded: 2 } });
    expect(byPath(sim.targetTreeOf())).toEqual(byPath(sim.trees['tree_src1'] ?? []));
    // b.txt modified and dir/new.txt added are uploaded. a.txt is untouched.
    expect(sim.log.filter((l) => l === 'createBlob')).toHaveLength(2);
    expect(sim.treeWrites[0]?.base).toBe('tree_tgt1');
    expect(sim.treeWrites[0]?.entries).toContainEqual(expect.objectContaining({ path: 'gone.txt', sha: null }));
    expect(sim.commitsMade[0]?.parents).toEqual(['tgt1']);
    expect(sim.commitsMade[0]?.message).toBe('Sync me/src@main (src1)');
    expect(sim.refWrites).toEqual([{ kind: 'update', branch: 'main', sha: 'newcommit_2', force: false }]);
    expect(progress.at(-1)).toMatchObject({ phase: 'updating-branch', done: 1, total: 1 });
    expect(progress.filter((p) => p.phase === 'uploading').at(-1)).toMatchObject({ done: 2, total: 2 });
  });

  it('moves the branch last, so an earlier failure leaves the target untouched', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    await run(sim, plan);
    expect(sim.log.at(-1)).toBe('updateRef');
    expect(sim.log.indexOf('createCommit')).toBeLessThan(sim.log.indexOf('updateRef'));
  });

  it('passes force when the plan says force push', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ write: 'force-push' }));
    await run(sim, plan);
    expect(sim.refWrites[0]?.force).toBe(true);
  });

  it('creates a missing branch with a parentless commit and no base tree', async () => {
    const sim = scenario({ target: 'missing' });
    const plan = await planFor(sim);
    const res = await run(sim, plan);
    expect(res.ok).toBe(true);
    expect(sim.treeWrites[0]?.base).toBeUndefined();
    expect(sim.commitsMade[0]?.parents).toEqual([]);
    expect(sim.refWrites[0]?.kind).toBe('create');
    expect(byPath(sim.targetTreeOf())).toEqual(byPath(sim.trees['tree_src1'] ?? []));
  });

  it('bootstraps an empty target repository, then syncs the rest', async () => {
    const sim = scenario({ target: 'empty' });
    const plan = await planFor(sim);
    const res = await run(sim, plan);
    expect(res.ok).toBe(true);
    expect(sim.log.find((l) => l.startsWith('createFirstFile'))).toBeDefined();
    expect(byPath(sim.targetTreeOf())).toEqual(byPath(sim.trees['tree_src1'] ?? []));
  });

  it('chains tree chunks when there are more than 1000 changes', async () => {
    const files = Array.from({ length: 2500 }, (_, i) => file(`f${i}.txt`, `c${i}`));
    const sim = scenario({ target: 'missing', sourceFiles: files });
    const plan = await planFor(sim);
    const res = await run(sim, plan);
    expect(res.ok).toBe(true);
    expect(sim.treeWrites.map((t) => t.entries.length)).toEqual([1000, 1000, 500]);
    expect(sim.treeWrites[0]?.base).toBeUndefined();
    expect(sim.treeWrites[1]?.base).toBe('newtree_1');
    expect(sim.treeWrites[2]?.base).toBe('newtree_2');
    expect(sim.targetTreeOf()).toHaveLength(2500);
  });

  it('refuses a stale plan when the target moved after the preview, and writes nothing', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    sim.addCommit('tgt2', [file('a.txt', 'A')]);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt2' };
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'stale_plan' } });
    expect(sim.log.filter((l) => l.startsWith('create') || l === 'updateRef')).toEqual([]);
  });

  it('refuses a plan that has blockers', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ target: { repo: repo('me/dst', { archived: true }), branch: 'main' } }));
    sim.log = []; // planning reads; only what the engine does matters here
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'plan_blocked' } });
    expect(sim.log).toEqual([]);
  });

  it('refuses to run an engine the plan did not pick', async () => {
    const sim = scenario();
    const plan = { ...(await planFor(sim)), engine: 'ref-copy' as const };
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'not_supported', engine: 'ref-copy' } });
  });

  it('aborts on a hash mismatch and publishes nothing', async () => {
    const sim = scenario();
    sim.corruptBlobs = true;
    const plan = await planFor(sim);
    expect(await run(sim, plan)).toMatchObject({ ok: false, error: { code: 'blob_mismatch' } });
    expect(sim.log).not.toContain('createTree');
    expect(sim.log).not.toContain('updateRef');
  });

  it('stops on an upload failure and leaves the branch alone', async () => {
    const sim = scenario();
    sim.failCreateBlob = { code: 'forbidden', message: 'nope' };
    const plan = await planFor(sim);
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'forbidden', message: 'nope' } });
    expect(sim.log).not.toContain('createCommit');
    expect(sim.log).not.toContain('updateRef');
  });

  it('cancels mid-upload without touching the branch', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    const ctl = new AbortController();
    sim.onCreateBlob = () => ctl.abort();
    expect(await run(sim, plan, ctl.signal)).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(sim.log).not.toContain('createCommit');
    expect(sim.log).not.toContain('updateRef');
  });

  it('does nothing when already cancelled', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    const ctl = new AbortController();
    ctl.abort();
    expect(await run(sim, plan, ctl.signal)).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(sim.log.filter((l) => l.startsWith('create'))).toEqual([]);
  });
});
