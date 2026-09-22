import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { signOutOnExtensionUpdate } from '@/src/auth/lifecycle';
import { ENSURE_OFFSCREEN_MESSAGE } from '@/src/messaging';
import { openSidePanelOnActionClick } from '@/src/sidePanel';

/**
 * Idempotently makes sure the offscreen document (the git-clone engine host, SPEC §8.3) is running.
 * Only one offscreen document may exist per extension, so this is the single place that creates it.
 */
async function ensureOffscreenDocument(): Promise<void> {
  const existing = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await browser.offscreen.createDocument({
    url: browser.runtime.getURL('/offscreen.html'),
    reasons: ['LOCAL_STORAGE'],
    justification: 'Runs isomorphic-git (fs backed by IndexedDB) to clone and push full commit history.',
  });
}

export default defineBackground(() => {
  void openSidePanelOnActionClick();
  signOutOnExtensionUpdate();

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== ENSURE_OFFSCREEN_MESSAGE) {
      return undefined;
    }
    return ensureOffscreenDocument()
      .then(() => 'ready' as const)
      .catch(() => 'failed' as const);
  });
});
