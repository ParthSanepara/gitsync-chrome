import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CREDENTIAL_TTL_MS } from '@/src/auth/config';
import { signOutOnExtensionUpdate } from '@/src/auth/lifecycle';
import { clearCredentials, loadCredentials, saveCredential } from '@/src/auth/store';
import { validateCredential } from '@/src/auth/validate';
import type { Credential } from '@/src/providers/types';

const NOW = Date.now();
const cred = (over: Partial<Credential> = {}): Credential => ({
  key: 'github.com:octo',
  kind: 'oauth',
  token: 'gho_secret',
  scopes: ['repo', 'workflow'],
  login: 'octo',
  expiresAt: NOW + CREDENTIAL_TTL_MS,
  ...over,
});
const raw = () => fakeBrowser.storage.local.get('credentials').then((r) => r['credentials']);

describe('credential store (7-day login)', () => {
  beforeEach(() => fakeBrowser.reset());

  it('lives in local storage, never sync, and survives a "browser restart" (session storage is empty)', async () => {
    await saveCredential(cred());
    await fakeBrowser.storage.session.clear(); // what a browser restart does
    expect(Object.keys(await loadCredentials(NOW))).toEqual(['github.com:octo']);
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });

  it('is still valid on day 6 and gone after day 7', async () => {
    await saveCredential(cred());
    const day = 24 * 60 * 60 * 1000;
    expect(Object.keys(await loadCredentials(NOW + 6 * day))).toHaveLength(1);
    expect(await loadCredentials(NOW + 7 * day + 1)).toEqual({});
    expect(await raw()).toBeUndefined(); // and it is deleted, not just hidden
  });

  it('drops a credential whose expiry was pushed far into the future (tampering)', async () => {
    await saveCredential(cred({ expiresAt: NOW + 30 * 24 * 60 * 60 * 1000 }));
    expect(await loadCredentials(NOW)).toEqual({});
    expect(await raw()).toBeUndefined();
  });

  it('drops and deletes malformed data, including a credential with no expiry', async () => {
    await fakeBrowser.storage.local.set({ credentials: { 'github.com:octo': { ...cred(), expiresAt: undefined } } });
    expect(await loadCredentials(NOW)).toEqual({});
    expect(await raw()).toBeUndefined();
    await fakeBrowser.storage.local.set({ credentials: 'not an object' });
    expect(await loadCredentials(NOW)).toEqual({});
    expect(await raw()).toBeUndefined();
  });

  it('keeps the good credentials when only one has expired', async () => {
    await saveCredential(cred());
    await saveCredential(cred({ key: 'github.com:other', login: 'other', expiresAt: NOW - 1 }));
    expect(Object.keys(await loadCredentials(NOW))).toEqual(['github.com:octo']);
  });

  it('clearCredentials removes local and any leftover session copy', async () => {
    await saveCredential(cred());
    await fakeBrowser.storage.session.set({ credentials: { old: 1 } });
    await clearCredentials();
    expect(await raw()).toBeUndefined();
    expect((await fakeBrowser.storage.session.get('credentials'))['credentials']).toBeUndefined();
  });
});

describe('sign out on extension update', () => {
  beforeEach(() => fakeBrowser.reset());

  it('clears the login on an update, but not on install, browser update, or startup', async () => {
    signOutOnExtensionUpdate();
    await saveCredential(cred({ expiresAt: Date.now() + CREDENTIAL_TTL_MS }));

    fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    await Promise.resolve();
    expect(await raw()).toBeDefined();

    fakeBrowser.runtime.onInstalled.trigger({ reason: 'update' });
    await vi.waitFor(async () => expect(await raw()).toBeUndefined());
  });
});

describe('validateCredential', () => {
  const identity = (login: string, scopes: string | null, status = 200) =>
    (async () =>
      new Response(JSON.stringify({ login, id: 1 }), {
        status,
        headers: scopes === null ? {} : { 'x-oauth-scopes': scopes },
      })) as unknown as typeof fetch;

  it('accepts a token that is the same account with the same scopes', async () => {
    expect(await validateCredential(cred(), identity('octo', 'repo, workflow'))).toEqual({ status: 'valid' });
  });

  it('accepts when GitHub does not report scopes', async () => {
    expect(await validateCredential(cred(), identity('octo', null))).toEqual({ status: 'valid' });
  });

  it('flags a revoked token (401)', async () => {
    expect(await validateCredential(cred(), identity('octo', null, 401))).toEqual({ status: 'revoked' });
  });

  it('flags a token that now belongs to another account', async () => {
    expect(await validateCredential(cred(), identity('mallory', 'repo, workflow'))).toEqual({
      status: 'changed',
      reason: 'account',
    });
  });

  it('flags changed permissions', async () => {
    expect(await validateCredential(cred(), identity('octo', 'repo, workflow, admin:org'))).toEqual({
      status: 'changed',
      reason: 'scopes',
    });
  });

  it('does not sign the user out when it simply cannot reach GitHub', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await validateCredential(cred(), offline)).toEqual({ status: 'unknown' });
    expect(await validateCredential(cred(), identity('octo', null, 502))).toEqual({ status: 'unknown' });
  });
});
