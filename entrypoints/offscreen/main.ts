import './buffer-shim';
import LightningFS from '@isomorphic-git/lightning-fs';
import git, { type GitAuth } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { browser } from 'wxt/browser';
import { err, ok, type Result, type SyncError } from '@/src/errors';
import type { Progress } from '@/src/engines/types';
import { GIT_CLONE_PORT, type CloneCommand, type CloneEvent, type CloneJob, type CloneOutcome } from '@/src/messaging';

// VERIFY (SPEC §15 Q1): confirm this auth form works for both PATs (classic and fine-grained) and
// OAuth device-flow tokens over HTTPS git. `x-access-token` is GitHub's documented form for both.
function onAuthFor(token: string) {
  return (): GitAuth => ({ username: 'x-access-token', password: token });
}

function describeGitError(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

async function runJob(
  job: CloneJob,
  send: (e: CloneEvent) => void,
  isCancelled: () => boolean,
): Promise<Result<CloneOutcome, SyncError>> {
  const fs = new LightningFS('gitsync', { wipe: true });
  const dir = '/repo';

  let lastSent = 0;
  const say = (phase: Progress['phase'], message: string) => {
    const now = Date.now();
    if (now - lastSent < 250) return;
    lastSent = now;
    send({ type: 'progress', progress: { phase, done: 0, total: 0, message } });
  };

  if (isCancelled()) return err({ code: 'cancelled' });
  say('preparing', `Cloning ${job.source.cloneUrl}`);
  try {
    await git.clone({
      fs,
      http,
      dir,
      url: job.source.cloneUrl,
      ref: job.source.ref,
      singleBranch: true,
      // A shallow clone cannot be pushed as full history (SPEC §8.3): no `depth` here, ever.
      noCheckout: true,
      onAuth: onAuthFor(job.source.credential.token),
      onProgress: (e) => say('preparing', `Cloning: ${e.phase} ${e.loaded}${e.total ? `/${e.total}` : ''}`),
      onMessage: (m) => say('preparing', m.trim()),
    });
  } catch (e) {
    return err({ code: 'clone_failed', message: describeGitError(e) });
  }

  if (isCancelled()) return err({ code: 'cancelled' });
  const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
  const branch = await git.currentBranch({ fs, dir });
  say('updating-branch', `Pushing to ${job.target.cloneUrl}`);
  try {
    await git.addRemote({ fs, dir, remote: 'target', url: job.target.cloneUrl });
    const pushed = await git.push({
      fs,
      http,
      dir,
      remote: 'target',
      ref: branch ?? head,
      remoteRef: `refs/heads/${job.target.branch}`,
      force: job.target.force,
      onAuth: onAuthFor(job.target.credential.token),
      onProgress: (e) => say('updating-branch', `Pushing: ${e.phase} ${e.loaded}${e.total ? `/${e.total}` : ''}`),
      onMessage: (m) => say('updating-branch', m.trim()),
    });
    if (!pushed.ok) return err({ code: 'push_failed', message: JSON.stringify(pushed.error ?? pushed.refs) });
  } catch (e) {
    return err({ code: 'push_failed', message: describeGitError(e) });
  }

  return ok({ commitSha: head });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== GIT_CLONE_PORT) return;
  let cancelled = false;
  let busy = false;

  port.onMessage.addListener((cmd: CloneCommand) => {
    if (cmd.type === 'cancel') {
      cancelled = true;
      return;
    }
    if (busy) return; // one job per port; the caller opens a fresh port per sync
    busy = true;
    void runJob(
      cmd.job,
      (e) => port.postMessage(e),
      () => cancelled,
    ).then((result) => {
      port.postMessage({ type: 'result', result } satisfies CloneEvent);
    });
  });
});
