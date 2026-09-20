// M0 spike service worker. Thin by design: create the offscreen doc and forward
// run requests. It never does git work itself.

const BOOTED_AT = new Date().toISOString();
console.log('[sw] booted', BOOTED_AT);

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Sync operations run for minutes; the service worker cannot host them.',
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.to !== 'sw') return;

  if (msg.type === 'run') {
    (async () => {
      await ensureOffscreen();
      // The token is read here and handed over by message: offscreen documents
      // only get chrome.runtime, not chrome.storage.
      const { pat } = await chrome.storage.session.get('pat');
      chrome.runtime.sendMessage({ to: 'offscreen', type: 'run', exp: msg.exp, params: msg.params, token: pat ?? '' });
      sendResponse({ ok: true, swBootedAt: BOOTED_AT });
    })();
    return true;
  }

  if (msg.type === 'saveToken') {
    // Device flow result from offscreen, which has no chrome.storage.
    chrome.storage.session.set({ pat: msg.token });
    chrome.runtime.sendMessage({ to: 'ui', type: 'tokenSaved' }).catch(() => {});
    return;
  }

  if (msg.type === 'ping') {
    sendResponse({ swBootedAt: BOOTED_AT });
  }
});
