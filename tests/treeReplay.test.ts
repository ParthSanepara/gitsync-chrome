import { describe, expect, it } from 'vitest';
import { treeReplay } from '@/src/engines/treeReplay';
import type { Progress } from '@/src/engines/types';
import type { PlanRequest, SyncPlan } from '@/src/plan';
import { runSync } from '@/src/runner';
import { byPath, cred, file, planFor, repo, request, scenario } from './helpers/sim';

const run = (
  sim: Parameters<typeof runSync>[0],
  plan: SyncPlan,
  signal = new AbortController().signal,
  progress: Progress[] = [],
) => runSync(sim, plan, { source: cred, target: cred }, (p) => progress.push(p), signal);

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
    const res = await treeReplay.execute(
      sim,
      plan,
      { source: cred, target: cred },
      () => {},
      new AbortController().signal,
    );
    expect(res).toEqual({ ok: false, error: { code: 'not_supported', engine: 'ref-copy' } });
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

describe('treeReplay.execute: a new branch', () => {
  const feature = () => request({ target: { repo: repo('me/dst'), branch: 'feature/x' } });

  it('is created from the target default branch, leaves that branch alone, and equals the source', async () => {
    const sim = scenario();
    const plan = await planFor(sim, feature());
    const res = await run(sim, plan);

    expect(res.ok).toBe(true);
    expect(sim.refWrites).toEqual([{ kind: 'create', branch: 'feature/x', sha: 'newcommit_2' }]);
    expect(sim.commitsMade[0]?.parents).toEqual(['tgt1']);
    expect(sim.treeWrites[0]?.base).toBe('tree_tgt1');
    expect(sim.log.filter((l) => l === 'createBlob')).toHaveLength(2); // only what differs from main
    expect(byPath(sim.targetTreeOf('feature/x'))).toEqual(byPath(sim.trees['tree_src1'] ?? []));
    expect(sim.branches['me/dst#main']).toEqual({ state: 'exists', sha: 'tgt1' });
  });

  it('refuses if the default branch moved after the preview', async () => {
    const sim = scenario();
    const plan = await planFor(sim, feature());
    sim.addCommit('tgt2', [file('a.txt', 'A')]);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt2' };
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'stale_plan' } });
    expect(sim.refWrites).toEqual([]);
  });

  it('after bootstrapping an empty repo, branches from the new default branch', async () => {
    const sim = scenario({ target: 'empty' });
    const plan = await planFor(sim, feature());
    const res = await run(sim, plan);
    expect(res.ok).toBe(true);
    expect(sim.refWrites[0]).toMatchObject({ kind: 'create', branch: 'feature/x' });
    expect(sim.commitsMade[0]?.parents).toHaveLength(1);
    expect(byPath(sim.targetTreeOf('feature/x'))).toEqual(byPath(sim.trees['tree_src1'] ?? []));
  });
});

describe('protected branches and secret scanning', () => {
  it('reports a protected branch as its own problem, with the way out', async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    sim.failRefWrite = { code: 'validation', message: 'Protected branch update failed for refs/heads/main.' };
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'protected_branch' } });
  });

  it("reports secret scanning, keeping GitHub's explanation", async () => {
    const sim = scenario();
    const plan = await planFor(sim);
    sim.failCreateBlob = { code: 'conflict', message: 'Secret detected: GH013 push protection.' };
    expect(await run(sim, plan)).toEqual({
      ok: false,
      error: { code: 'secret_scanning', message: 'Secret detected: GH013 push protection.' },
    });
  });
});

describe('pull-request mode', () => {
  const pr = (over: Partial<PlanRequest> = {}) => request({ write: 'pull-request', ...over });

  it('syncs to a gitsync/ work branch created from the base, then opens a PR into the base', async () => {
    const sim = scenario();
    const plan = await planFor(sim, pr());
    expect(plan.target.branch).toBe('gitsync/main');
    expect(plan.pullRequest).toEqual({ base: 'main', head: 'gitsync/main' });
    expect(plan.target.base).toEqual({ branch: 'main', sha: 'tgt1' });

    const res = await run(sim, plan);
    expect(res).toMatchObject({ ok: true, value: { pullRequestUrl: 'https://github.com/me/dst/pull/1' } });
    expect(sim.branches['me/dst#main']).toEqual({ state: 'exists', sha: 'tgt1' }); // base untouched
    expect(sim.refWrites[0]).toMatchObject({ kind: 'create', branch: 'gitsync/main' });
    expect(sim.commitsMade[0]?.parents).toEqual(['tgt1']);
    expect(sim.prs[0]).toMatchObject({ head: 'gitsync/main', base: 'main', title: 'Sync me/src@main' });
    expect(sim.log.at(-1)).toBe('openPullRequest');
  });

  it('reuses the work branch and the open PR on a second run', async () => {
    const sim = scenario();
    await run(sim, await planFor(sim, pr()));
    sim.addCommit('src2', [file('a.txt', 'A'), file('b.txt', 'B3')]);
    sim.branches['me/src#main'] = { state: 'exists', sha: 'src2' };
    sim.failPr = { code: 'validation', message: 'A pull request already exists for me:gitsync/main.' };
    sim.existingPr = { url: 'https://github.com/me/dst/pull/9' };

    const plan = await planFor(sim, pr());
    expect(plan.target.exists).toBe(true); // updates gitsync/main
    const res = await run(sim, plan);
    expect(res).toMatchObject({ ok: true, value: { pullRequestUrl: 'https://github.com/me/dst/pull/9' } });
    expect(sim.refWrites.at(-1)).toMatchObject({ kind: 'update', branch: 'gitsync/main' });
  });

  it('needs the base branch to exist', async () => {
    const sim = scenario({ target: 'missing' });
    expect((await planFor(sim, pr())).blockers).toContainEqual({ code: 'pr_base_missing' });
  });

  it('says so when the branch was updated but the PR failed', async () => {
    const sim = scenario();
    const plan = await planFor(sim, pr());
    sim.failPr = { code: 'validation', message: 'No commits between main and gitsync/main' };
    expect(await run(sim, plan)).toEqual({
      ok: false,
      error: { code: 'pr_failed', message: 'No commits between main and gitsync/main' },
    });
    expect(sim.refWrites).toHaveLength(1);
  });
});

describe('ref-copy engine', () => {
  const full = (over: Partial<PlanRequest> = {}) => request({ mode: 'full', ...over });

  it('creates a missing branch at the source commit with a single ref write', async () => {
    const sim = scenario({ target: 'missing' });
    sim.reachable = true;
    const plan = await planFor(sim, full());
    expect(plan.engine).toBe('ref-copy');
    const res = await run(sim, plan);
    expect(res).toMatchObject({ ok: true, value: { commitSha: 'src1', blobsUploaded: 0 } });
    expect(sim.refWrites).toEqual([{ kind: 'create', branch: 'main', sha: 'src1' }]);
    expect(sim.log).not.toContain('createBlob');
    expect(sim.log).not.toContain('createCommit');
  });

  it('moves an existing branch only with force push, and passes force', async () => {
    const sim = scenario();
    sim.reachable = true;
    expect((await planFor(sim, full())).blockers).toContainEqual({ code: 'needs_force' });
    const plan = await planFor(sim, full({ write: 'force-push' }));
    expect((await run(sim, plan)).ok).toBe(true);
    expect(sim.refWrites).toEqual([{ kind: 'update', branch: 'main', sha: 'src1', force: true }]);
  });

  it('refuses if the target moved after the preview', async () => {
    const sim = scenario();
    sim.reachable = true;
    const plan = await planFor(sim, full({ write: 'force-push' }));
    sim.addCommit('tgt2', []);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt2' };
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'stale_plan' } });
    expect(sim.refWrites).toEqual([]);
  });

  it('refuses if the commit is no longer reachable from the target', async () => {
    const sim = scenario({ target: 'missing' });
    sim.reachable = true;
    const plan = await planFor(sim, full());
    sim.reachable = false;
    expect(await run(sim, plan)).toEqual({ ok: false, error: { code: 'commit_unreachable' } });
  });

  it('opens a PR from a work branch it may force-move', async () => {
    const sim = scenario();
    sim.reachable = true;
    const plan = await planFor(sim, full({ write: 'pull-request' }));
    expect(plan.blockers).toEqual([]);
    const res = await run(sim, plan);
    expect(res).toMatchObject({ ok: true, value: { pullRequestUrl: expect.stringContaining('/pull/') } });
    expect(sim.refWrites[0]).toMatchObject({ kind: 'create', branch: 'gitsync/main', sha: 'src1' });
  });
});
