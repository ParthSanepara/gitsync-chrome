import { browser } from 'wxt/browser';
import { err, ok, type Result, type SyncError } from '@/src/errors';
import type { Progress } from '@/src/engines/types';
import {
  ENSURE_OFFSCREEN_MESSAGE,
  GIT_CLONE_PORT,
  type CloneCommand,
  type CloneEvent,
  type CloneJob,
  type CloneOutcome,
} from '@/src/messaging';

/** Asks the background service worker to have the offscreen document running (SPEC §14 rule 2). */
export async function ensureOffscreenDocument(): Promise<Result<void, SyncError>> {
  try {
    const ack: unknown = await browser.runtime.sendMessage({ type: ENSURE_OFFSCREEN_MESSAGE });
    return ack === 'ready' ? ok(undefined) : err({ code: 'offscreen_unavailable' });
  } catch {
    return err({ code: 'offscreen_unavailable' });
  }
}

/**
 * Runs one clone+push job in the offscreen document and relays its progress (SPEC §8.3).
 * Cancellation is best-effort: the offscreen document only honours it before the clone (or the push)
 * starts. A push, once started, is a single network operation on the git side and is let finish rather
 * than left in an unknown state.
 */
export function runCloneJob(
  job: CloneJob,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<Result<CloneOutcome, SyncError>> {
  if (signal.aborted) return Promise.resolve(err({ code: 'cancelled' }));

  return new Promise((resolve) => {
    const port = browser.runtime.connect({ name: GIT_CLONE_PORT });
    let settled = false;

    const finish = (result: Result<CloneOutcome, SyncError>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      port.disconnect();
      resolve(result);
    };

    const onAbort = () => port.postMessage({ type: 'cancel' } satisfies CloneCommand);
    const onMessage = (event: CloneEvent) => {
      if (event.type === 'progress') onProgress(event.progress);
      else finish(event.result);
    };
    // Only fires if the offscreen document disappears mid-job (e.g. it was evicted); a normal finish
    // already resolved and detached this listener before calling `port.disconnect()` itself.
    const onDisconnect = () => finish(err({ code: 'offscreen_unavailable' }));

    signal.addEventListener('abort', onAbort);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ type: 'start', job } satisfies CloneCommand);
  });
}
