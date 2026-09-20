import { describe, expect, it } from 'vitest';
import { MAX_BATCH_BRANCHES, planBatch, runBatch, type BatchEvent, type BatchRequest } from '@/src/batch';
import { byPath, cred, file, repo, Sim } from './helpers/sim';

const ctl = () => new AbortController().signal;

/** Source has three branches; the target only has main. */
function world() {
  const sim = new Sim();
  sim.addCommit('s_main', [file('a.txt', 'A2'), file('b.txt', 'B')]);
  sim.addCommit('s_dev', [file('a.txt', 'A2'), file('b.txt', 'B'), file('dev.txt', 'D')]);
  sim.addCommit('s_feat', [file('a.txt', 'A2'), file('feat/x.txt', 'X')]);
  sim.branches['me/src#main'] = { state: 'exists', sha: 's_main' };
  sim.branches['me/src#dev'] = { state: 'exists', sha: 's_dev' };
  sim.branches['me/src#feature/x'] = { state: 'exists', sha: 's_feat' };
  sim.addCommit('t_main', [file('a.txt', 'A1'), file('b.txt', 'B')]);
  sim.branches['me/dst#main'] = { state: 'exists', sha: 't_main' };
  return sim;
}

const req = (over: Partial<BatchRequest> = {}): BatchRequest => ({
  source: { repo: repo('me/src') },
  target: { repo: repo('me/dst') },
  mode: 'snapshot',
  write: 'push',
  credentials: { source: cred, target: cred },
  ...over,
});

describe('planBatch', () => {
  it('plans every source branch, default branch first, against the same-named target branch', async () => {
    const res = await planBatch(world(), req(), () => {}, ctl());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((i) => i.branch)).toEqual(['main', 'dev', 'feature/x']);
    expect(res.value.map((i) => i.plan?.target.exists)).toEqual([true, false, false]);
    expect(res.value[1]?.plan?.target.base).toEqual({ branch: 'main', sha: 't_main' });
  });

  it('reports progress', async () => {
    const seen: Array<[number, number]> = [];
    await planBatch(world(), req(), (d, t) => seen.push([d, t]), ctl());
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.at(-1)).toEqual([3, 3]);
  });

  it('refuses a repo with too many branches instead of burning the API budget', async () => {
    const sim = world();
    for (let i = 0; i < MAX_BATCH_BRANCHES + 1; i++) sim.branches[`me/src#b${i}`] = { state: 'exists', sha: 's_main' };
    const res = await planBatch(sim, req(), () => {}, ctl());
    expect(res).toMatchObject({ ok: false, error: { code: 'too_many_branches' } });
  });

  it('keeps going when one branch cannot be planned, and says which', async () => {
    const sim = world();
    const original = sim.resolveRef;
    sim.resolveRef = async (c, r, ref) =>
      ref === 'dev' ? { ok: false, error: { code: 'not_found' } } : original(c, r, ref);
    const res = await planBatch(sim, req(), () => {}, ctl());
    expect(res.ok && res.value.map((i) => [i.branch, Boolean(i.plan), Boolean(i.error)])).toEqual([
      ['main', true, false],
      ['dev', false, true],
      ['feature/x', true, false],
    ]);
  });

  it('stops everything on an expired login, since every next call would fail too', async () => {
    const sim = world();
    sim.resolveRef = async () => ({ ok: false, error: { code: 'unauthorized' } });
    expect(await planBatch(sim, req(), () => {}, ctl())).toEqual({ ok: false, error: { code: 'unauthorized' } });
  });
});

describe('runBatch', () => {
  it('syncs every branch so each target branch equals its source, creating the missing ones', async () => {
    const sim = world();
    const events: BatchEvent[] = [];
    const out = await runBatch(sim, req(), ['main', 'dev', 'feature/x'], (e) => events.push(e), ctl());

    expect(out.map((o) => [o.branch, o.outcome.status])).toEqual([
      ['main', 'synced'],
      ['dev', 'synced'],
      ['feature/x', 'synced'],
    ]);
    for (const [src, dst] of [
      ['s_main', 'main'],
      ['s_dev', 'dev'],
      ['s_feat', 'feature/x'],
    ] as const) {
      expect(byPath(sim.targetTreeOf(dst))).toEqual(byPath(sim.trees[`tree_${src}`] ?? []));
    }
    expect(events.filter((e) => e.type === 'finish')).toHaveLength(3);
  });

  it('re-plans each branch, so new branches start from the main that was just updated', async () => {
    const sim = world();
    await runBatch(sim, req(), ['main', 'dev'], () => {}, ctl());
    const mainTip = sim.branches['me/dst#main'];
    const devParent = sim.commitsMade.find((c) => c.message.includes('@dev'))?.parents[0];
    expect(mainTip).toMatchObject({ state: 'exists' });
    // dev was built on the NEW main commit, not the t_main it was planned against
    expect(devParent).toBe(mainTip?.state === 'exists' ? mainTip.sha : undefined);
    expect(devParent).not.toBe('t_main');
  });

  it('reports "up to date" for a branch that already matches, without touching it', async () => {
    const sim = world();
    sim.addCommit('t_dev', [file('a.txt', 'A2'), file('b.txt', 'B'), file('dev.txt', 'D')]);
    sim.branches['me/dst#dev'] = { state: 'exists', sha: 't_dev' };
    const out = await runBatch(sim, req(), ['dev'], () => {}, ctl());
    expect(out[0]?.outcome).toEqual({ status: 'up-to-date' });
    expect(sim.refWrites).toEqual([]);
  });

  it('skips a blocked branch with the reason and carries on with the rest', async () => {
    const sim = world();
    // "feature" cannot exist next to the existing "feature/x" on the target.
    sim.addCommit('s_f', [file('a.txt', 'A2')]);
    sim.branches['me/src#feature'] = { state: 'exists', sha: 's_f' };
    sim.addCommit('t_fx', [file('a.txt', 'A1')]);
    sim.branches['me/dst#feature/x'] = { state: 'exists', sha: 't_fx' };
    const out = await runBatch(sim, req(), ['feature', 'dev'], () => {}, ctl());
    expect(out[0]?.outcome).toMatchObject({ status: 'skipped', reasons: [expect.stringContaining('feature/x')] });
    expect(out[1]?.outcome.status).toBe('synced');
  });

  it('a failing branch does not stop the others', async () => {
    const sim = world();
    let calls = 0;
    const createRef = sim.createRef;
    sim.createRef = async (c, r, b, s) =>
      ++calls === 1 ? { ok: false, error: { code: 'forbidden', message: 'nope' } } : createRef(c, r, b, s);
    const out = await runBatch(sim, req(), ['dev', 'feature/x'], () => {}, ctl());
    expect(out.map((o) => o.outcome.status)).toEqual(['failed', 'synced']);
  });

  it('cancelling stops after the current branch and marks the rest as not run', async () => {
    const sim = world();
    const c = new AbortController();
    const out = await runBatch(
      sim,
      req(),
      ['main', 'dev', 'feature/x'],
      (e) => {
        if (e.type === 'finish' && e.branch === 'main') c.abort();
      },
      c.signal,
    );
    expect(out.map((o) => o.outcome.status)).toEqual(['synced', 'not-run', 'not-run']);
  });

  it('stops on an expired login instead of failing every remaining branch', async () => {
    const sim = world();
    sim.resolveRef = async () => ({ ok: false, error: { code: 'unauthorized' } });
    const out = await runBatch(sim, req(), ['main', 'dev'], () => {}, ctl());
    expect(out.map((o) => o.outcome.status)).toEqual(['failed', 'not-run']);
  });
});
