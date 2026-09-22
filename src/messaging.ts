/** Typed channel between the side panel (or background) and the offscreen document (SPEC §10). */
import type { Progress } from '@/src/engines/types';
import type { Result, SyncError } from '@/src/errors';

/** Runtime message asking the background service worker to have the offscreen document ready. */
export const ENSURE_OFFSCREEN_MESSAGE = 'gitsync:ensure-offscreen';

/** `chrome.runtime.connect` port name the offscreen document listens on for git-clone jobs. */
export const GIT_CLONE_PORT = 'gitsync:git-clone';

export interface CloneJob {
  source: { cloneUrl: string; ref: string; credential: { token: string } };
  target: { cloneUrl: string; branch: string; credential: { token: string }; force: boolean };
}

export interface CloneOutcome {
  /** The commit the target branch now points at. Identical to the source commit: real git preserves SHAs. */
  commitSha: string;
}

/** Caller → offscreen, over the `GIT_CLONE_PORT` port. */
export type CloneCommand = { type: 'start'; job: CloneJob } | { type: 'cancel' };

/**
 * Offscreen → caller, over the `GIT_CLONE_PORT` port. Never carries a token (SPEC §14 rule 7): a `CloneJob`
 * is sent once, into the offscreen document, and nothing sent back references it.
 */
export type CloneEvent =
  { type: 'progress'; progress: Progress } | { type: 'result'; result: Result<CloneOutcome, SyncError> };
