import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@/src/errors';
import { gitClone } from '@/src/engines/gitClone';
import type { Progress } from '@/src/engines/types';
import type { CloneJob } from '@/src/messaging';
import { cred, file, planFor, request, scenario } from './helpers/sim';

const { ensureOffscreenDocument, runCloneJob } = vi.hoisted(() => ({
  ensureOffscreenDocument: vi.fn(),
  runCloneJob: vi.fn(),
}));
vi.mock('@/src/offscreenClient', () => ({ ensureOffscreenDocument, runCloneJob }));

const run = (sim: Parameters<typeof gitClone.execute>[0], plan: Parameters<typeof gitClone.execute>[1]) =>
  gitClone.execute(sim, plan, { source: cred, target: cred }, () => {}, new AbortController().signal);

describe('gitClone.execute', () => {
  beforeEach(() => {
    ensureOffscreenDocument.mockReset().mockResolvedValue(ok(undefined));
    runCloneJob.mockReset().mockResolvedValue(ok({ commitSha: 'src1' }));
  });

  it('dispatches a clone+push job for the plan repos and branch, preserving the source SHA', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    const res = await run(sim, plan);

    expect(res).toMatchObject({ ok: true, value: { commitSha: 'src1', filesChanged: 0, blobsUploaded: 0 } });
    expect(runCloneJob).toHaveBeenCalledTimes(1);
    const job = runCloneJob.mock.calls[0]?.[0] as CloneJob;
    expect(job).toEqual({
      source: { cloneUrl: 'https://github.com/me/src.git', ref: 'main', credential: { token: cred.token } },
      target: {
        cloneUrl: 'https://github.com/me/dst.git',
        branch: 'main',
        credential: { token: cred.token },
        force: false,
      },
    });
  });

  it('passes force when the plan says force push', async () => {
    const sim = scenario();
    sim.reachable = false;
    const plan = await planFor(sim, request({ mode: 'full', write: 'force-push' }));
    await run(sim, plan);
    const job = runCloneJob.mock.calls[0]?.[0] as CloneJob;
    expect(job.target.force).toBe(true);
  });

  it('refuses a plan with blockers instead of starting a job', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    const res = await gitClone.execute(
      sim,
      { ...plan, blockers: [{ code: 'already_in_sync' }] },
      { source: cred, target: cred },
      () => {},
      new AbortController().signal,
    );
    expect(res).toEqual({ ok: false, error: { code: 'plan_blocked' } });
    expect(ensureOffscreenDocument).not.toHaveBeenCalled();
    expect(runCloneJob).not.toHaveBeenCalled();
  });

  it('refuses a stale plan when the target moved after the preview, and starts no job', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    sim.addCommit('tgt2', [file('a.txt', 'A')]);
    sim.branches['me/dst#main'] = { state: 'exists', sha: 'tgt2' };
    const res = await run(sim, plan);
    expect(res).toEqual({ ok: false, error: { code: 'stale_plan' } });
    expect(runCloneJob).not.toHaveBeenCalled();
  });

  it('does not start a job once already cancelled', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    const controller = new AbortController();
    controller.abort();
    const res = await gitClone.execute(sim, plan, { source: cred, target: cred }, () => {}, controller.signal);
    expect(res).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(runCloneJob).not.toHaveBeenCalled();
  });

  it('surfaces a clone/push failure from the offscreen document as-is', async () => {
    runCloneJob.mockResolvedValue(err({ code: 'push_failed', message: 'protected branch' }));
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    const res = await run(sim, plan);
    expect(res).toEqual({ ok: false, error: { code: 'push_failed', message: 'protected branch' } });
  });

  it('relays progress from the offscreen document to the caller', async () => {
    const progress: Progress[] = [];
    runCloneJob.mockImplementation(async (_job: CloneJob, onProgress: (p: Progress) => void) => {
      onProgress({ phase: 'preparing', done: 0, total: 0, message: 'Cloning' });
      return ok({ commitSha: 'src1' });
    });
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    await gitClone.execute(
      sim,
      plan,
      { source: cred, target: cred },
      (p) => progress.push(p),
      new AbortController().signal,
    );
    expect(progress).toContainEqual({ phase: 'preparing', done: 0, total: 0, message: 'Cloning' });
  });

  it('opens a pull request when the plan calls for one', async () => {
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full', write: 'pull-request' }));
    const res = await run(sim, plan);
    expect(res).toMatchObject({ ok: true, value: { pullRequestUrl: 'https://github.com/me/dst/pull/1' } });
    expect(sim.prs).toEqual([expect.objectContaining({ base: 'main' })]);
  });

  it('fails if the offscreen document cannot be created', async () => {
    ensureOffscreenDocument.mockResolvedValue(err({ code: 'offscreen_unavailable' }));
    const sim = scenario();
    const plan = await planFor(sim, request({ mode: 'full' }));
    const res = await run(sim, plan);
    expect(res).toEqual({ ok: false, error: { code: 'offscreen_unavailable' } });
    expect(runCloneJob).not.toHaveBeenCalled();
  });
});
