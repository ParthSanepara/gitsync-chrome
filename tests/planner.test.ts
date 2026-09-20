import { describe, expect, it } from 'vitest';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import type { PlanRequest } from '@/src/plan';
import { buildPlan, MAX_BLOB_BYTES } from '@/src/planner';
import type { BranchState, Commit, Credential, Provider, RateLimit, Repo, TreeEntry } from '@/src/providers/types';

const oauth = (scopes: string[]): Credential => ({
  key: 'github.com:me',
  kind: 'oauth',
  token: 't',
  scopes,
  login: 'me',
});
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
const blob = (path: string, sha: string, size = 10): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size });

interface World {
  commits: Record<string, Commit>; // by sha or ref name
  branches: Record<string, BranchState>; // by `${fullName}#${branch}`
  trees: Record<string, { entries: TreeEntry[]; truncated?: boolean }>; // by tree sha
  blobs: Record<string, string>;
  reachable: boolean;
  rate?: RateLimit;
}

function fake(w: World): Provider & { calls: string[] } {
  const calls: string[] = [];
  const nf: Result<never, ApiError> = err({ code: 'not_found' });
  return {
    calls,
    id: 'github',
    host: 'api.github.com',
    listRepos: async () => ok([]),
    getRepo: async () => nf,
    listRefs: async () => ok([]),
    resolveRef: async (_c, _r, ref) => {
      calls.push(`resolve ${ref}`);
      const c = w.commits[ref];
      return c ? ok(c) : nf;
    },
    getBranch: async (_c, r, b) => ok(w.branches[`${r.owner}/${r.name}#${b}`] ?? { state: 'missing' }),
    getTree: async (_c, _r, sha) => {
      calls.push(`tree ${sha}`);
      const t = w.trees[sha];
      return t ? ok({ entries: t.entries, truncated: t.truncated ?? false }) : nf;
    },
    readBlobText: async (_c, _r, sha) => {
      calls.push(`blob ${sha}`);
      const b = w.blobs[sha];
      return b === undefined ? nf : ok(b);
    },
    canReachCommit: async () => ok(w.reachable),
    rateLimit: () => w.rate,
  };
}

const srcCommit: Commit = { sha: 'src1', treeSha: 'srcTree', message: 'm', parents: [] };
const tgtCommit: Commit = { sha: 'tgt1', treeSha: 'tgtTree', message: 'm', parents: [] };

function world(over: Partial<World> = {}): World {
  return {
    commits: { main: srcCommit, src1: srcCommit, tgt1: tgtCommit },
    branches: { 'me/dst#main': { state: 'exists', sha: 'tgt1' } },
    trees: {
      srcTree: { entries: [blob('a.txt', 'A'), blob('b.txt', 'B2', 50), blob('new.txt', 'N', 30)] },
      tgtTree: { entries: [blob('a.txt', 'A'), blob('b.txt', 'B1'), blob('gone.txt', 'G')] },
    },
    blobs: {},
    reachable: false,
    ...over,
  };
}

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  source: { repo: repo('me/src'), ref: 'main' },
  target: { repo: repo('me/dst'), branch: 'main' },
  mode: 'snapshot',
  write: 'push',
  credentials: { source: oauth(['repo']), target: oauth(['repo']) },
  ...over,
});

async function plan(w: World, req: PlanRequest = request()) {
  const res = await buildPlan(fake(w), req);
  if (!res.ok) throw new Error(`plan failed: ${res.error.code}`);
  return res.value;
}
const codes = (list: Array<{ code: string }>) => list.map((x) => x.code);

describe('snapshot / tree-replay', () => {
  it('diffs against the existing target and counts only what must change', async () => {
    const p = await plan(world());
    expect(p.engine).toBe('tree-replay');
    // b.txt modified, new.txt added, gone.txt deleted. a.txt is identical.
    expect(p.estimate).toEqual({ filesChanged: 3, blobsToUpload: 2, commits: 1, apiCalls: 2 * 2 + 1 + 2, bytes: 80 });
    expect(p.blockers).toEqual([]);
    expect(codes(p.warnings)).toContain('sha_not_preserved');
    expect(p.target).toMatchObject({ exists: true, currentSha: 'tgt1', empty: false });
  });

  it('skips uploading a file whose content already exists elsewhere in the target', async () => {
    const w = world();
    w.trees.tgtTree = { entries: [blob('a.txt', 'A'), blob('moved.txt', 'N')] };
    const p = await plan(w);
    // new.txt has blob N, already in the target under another name, so no upload.
    expect(p.estimate.blobsToUpload).toBe(1);
  });

  it('uploads everything when the target branch does not exist, and says it will be created', async () => {
    const p = await plan(world({ branches: {} }));
    expect(p.estimate.blobsToUpload).toBe(3);
    expect(p.estimate.filesChanged).toBe(3);
    expect(codes(p.warnings)).toContain('target_branch_created');
    expect(p.target.exists).toBe(false);
  });

  it('flags an empty target repo', async () => {
    const p = await plan(world({ branches: { 'me/dst#main': { state: 'empty-repo' } } }));
    expect(codes(p.warnings)).toContain('target_repo_empty');
    expect(p.target.empty).toBe(true);
  });

  it('blocks when the target already matches', async () => {
    const w = world();
    w.trees.tgtTree = { entries: w.trees.srcTree?.entries ?? [] };
    expect(codes((await plan(w)).blockers)).toEqual(['already_in_sync']);
  });

  it('blocks oversize blobs but ignores oversize files that do not need uploading', async () => {
    const w = world();
    w.trees.srcTree = { entries: [blob('a.txt', 'A'), blob('huge.bin', 'H', MAX_BLOB_BYTES + 1)] };
    const p = await plan(w);
    expect(p.blockers).toContainEqual({
      code: 'oversize_blob',
      path: 'huge.bin',
      sizeBytes: MAX_BLOB_BYTES + 1,
      limitBytes: MAX_BLOB_BYTES,
    });
  });

  it('blocks Git LFS repos by reading .gitattributes', async () => {
    const w = world({ blobs: { GA: '*.psd filter=lfs diff=lfs merge=lfs -text\n' } });
    w.trees.srcTree = { entries: [blob('a.txt', 'A'), blob('.gitattributes', 'GA')] };
    expect((await plan(w)).blockers).toContainEqual({ code: 'lfs_detected', path: '.gitattributes' });
  });

  it('does not flag a .gitattributes without LFS', async () => {
    const w = world({ blobs: { GA: '* text=auto\n' } });
    w.trees.srcTree = { entries: [blob('a.txt', 'A'), blob('.gitattributes', 'GA')] };
    expect(codes((await plan(w)).blockers)).toEqual([]);
  });

  it('warns about submodules', async () => {
    const w = world();
    w.trees.srcTree = { entries: [blob('a.txt', 'A'), { path: 'lib', mode: '160000', type: 'commit', sha: 'S' }] };
    expect((await plan(w)).warnings).toContainEqual({ code: 'submodules', count: 1 });
  });

  it('needs the workflow scope only when workflow files change (OAuth)', async () => {
    const w = world();
    w.trees.srcTree = { entries: [blob('.github/workflows/ci.yml', 'W')] };
    const missing = await plan(w);
    expect(missing.blockers).toContainEqual({ code: 'missing_workflow_scope', paths: ['.github/workflows/ci.yml'] });

    const granted = await plan(
      w,
      request({ credentials: { source: oauth(['repo']), target: oauth(['repo', 'workflow']) } }),
    );
    expect(codes(granted.blockers)).not.toContain('missing_workflow_scope');

    // An unrelated change never asks for it.
    expect(codes((await plan(world())).blockers)).not.toContain('missing_workflow_scope');
  });

  it('blocks a truncated source tree', async () => {
    const w = world();
    w.trees.srcTree = { entries: [], truncated: true };
    expect(codes((await plan(w)).blockers)).toContain('tree_truncated');
  });

  it('chunks big tree updates', async () => {
    const w = world({ branches: {} });
    w.trees.srcTree = { entries: Array.from({ length: 2500 }, (_, i) => blob(`f${i}`, `s${i}`, 1)) };
    const p = await plan(w);
    expect(p.estimate.blobsToUpload).toBe(2500);
    expect(p.estimate.apiCalls).toBe(2500 * 2 + 3 + 2);
  });
});

describe('target and request checks', () => {
  it('blocks an archived target, a target without push access, and the same branch', async () => {
    const p1 = await plan(world(), request({ target: { repo: repo('me/dst', { archived: true }), branch: 'main' } }));
    expect(codes(p1.blockers)).toContain('target_archived');
    const p2 = await plan(world(), request({ target: { repo: repo('me/dst', { canPush: false }), branch: 'main' } }));
    expect(codes(p2.blockers)).toContain('no_push_permission');
    const p3 = await plan(world(), request({ target: { repo: repo('me/src'), branch: 'main' } }));
    expect(codes(p3.blockers)).toContain('same_branch');
  });

  it('warns, but does not block, when write access is unknown', async () => {
    const p = await plan(
      world(),
      request({ target: { repo: repo('me/dst', { canPush: undefined }), branch: 'main' } }),
    );
    expect(codes(p.warnings)).toContain('write_access_unverified');
    expect(codes(p.blockers)).toEqual([]);
  });

  it('blocks pull-request mode until it exists', async () => {
    expect((await plan(world(), request({ write: 'pull-request' }))).blockers).toContainEqual({
      code: 'unsupported',
      what: 'pull-request',
    });
  });

  it('blocks when the API budget is too low, using the client-reported limit', async () => {
    const p = await plan(world({ rate: { remaining: 50, resetAt: 1_700_000_000_000 } }));
    expect(p.blockers).toContainEqual({ code: 'rate_budget', needed: 7, remaining: 50, resetAt: 1_700_000_000_000 });
  });

  it('propagates API errors instead of planning', async () => {
    const w = world();
    delete w.commits.main;
    expect(await buildPlan(fake(w), request())).toEqual({ ok: false, error: { code: 'not_found' } });
  });
});

describe('engine selection', () => {
  it('full history + reachable commit → ref-copy', async () => {
    const p = await plan(world({ reachable: true, branches: {} }), request({ mode: 'full' }));
    expect(p.engine).toBe('ref-copy');
    expect(p.estimate).toEqual({ filesChanged: 0, blobsToUpload: 0, commits: 0, apiCalls: 1, bytes: 0 });
    expect(p.blockers).toEqual([]);
    expect(p.engineReason).toMatch(/fork network/);
  });

  it('ref-copy onto an existing branch requires force push', async () => {
    const w = world({ reachable: true });
    expect(codes((await plan(w, request({ mode: 'full' }))).blockers)).toEqual(['needs_force']);
    expect((await plan(w, request({ mode: 'full', write: 'force-push' }))).blockers).toEqual([]);
  });

  it('ref-copy where the target already has that commit → already in sync', async () => {
    const w = world({ reachable: true, branches: { 'me/dst#main': { state: 'exists', sha: 'src1' } } });
    expect(codes((await plan(w, request({ mode: 'full', write: 'force-push' }))).blockers)).toEqual([
      'already_in_sync',
    ]);
  });

  it('full history without a shared object store → git-clone, unavailable for now', async () => {
    const p = await plan(
      world({ reachable: false }),
      request({ mode: 'full', source: { repo: repo('me/src', { sizeKb: 2048 }), ref: 'main' } }),
    );
    expect(p.engine).toBe('git-clone');
    expect(p.blockers).toContainEqual({ code: 'engine_unavailable', engine: 'git-clone' });
    expect(p.estimate.bytes).toBe(2048 * 1024);
    expect(codes(p.warnings)).toContain('fork_probe_failed');
  });

  it('small last-N → tree-replay but unsupported for now; large last-N → git-clone', async () => {
    const small = await plan(world(), request({ mode: 'lastN', n: 5 }));
    expect(small.engine).toBe('tree-replay');
    expect(small.blockers).toContainEqual({ code: 'unsupported', what: 'last-n' });
    const large = await plan(world(), request({ mode: 'lastN', n: 500 }));
    expect(large.engine).toBe('git-clone');
  });

  it('does not probe the fork network for snapshot mode', async () => {
    const provider = fake(world({ reachable: true }));
    provider.canReachCommit = async () => {
      throw new Error('should not be called');
    };
    expect((await buildPlan(provider, request())).ok).toBe(true);
  });
});

describe('creating a branch that does not exist yet', () => {
  const feature = () => request({ target: { repo: repo('me/dst'), branch: 'feature/x' } });

  it('starts from the target default branch and only counts what differs from it', async () => {
    const p = await plan(world(), feature());
    expect(p.target).toMatchObject({ exists: false, base: { branch: 'main', sha: 'tgt1' } });
    // Same diff as syncing onto main: b.txt modified, new.txt added, gone.txt deleted.
    expect(p.estimate.filesChanged).toBe(3);
    expect(p.estimate.blobsToUpload).toBe(2);
    expect(p.warnings).toContainEqual({ code: 'target_branch_created', from: 'main' });
  });

  it('has no base when the target has no default branch to start from', async () => {
    const p = await plan(world({ branches: {} }), feature());
    expect(p.target.base).toBeUndefined();
    expect(p.estimate.blobsToUpload).toBe(3);
    expect(p.warnings).toContainEqual({ code: 'target_branch_created', from: undefined });
  });

  it('does not treat the default branch as a base for itself', async () => {
    const p = await plan(world({ branches: {} }));
    expect(p.target.base).toBeUndefined();
  });

  it('reports "already in sync" only against the base, so an identical default branch still gets the new branch', async () => {
    const w = world();
    w.trees.tgtTree = { entries: w.trees.srcTree?.entries ?? [] };
    // The new branch would be identical to main: nothing to commit.
    expect(codes((await plan(w, feature())).blockers)).toEqual(['already_in_sync']);
  });
});
