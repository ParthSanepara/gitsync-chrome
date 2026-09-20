import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { signInWithGitHub } from '@/src/auth/login';
import { clearCredentials, loadCredentials } from '@/src/auth/store';
import type { DeviceFlowDeps } from '@/src/auth/device';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeDeps(user: Response): DeviceFlowDeps {
  const queue = [
    json({
      device_code: 'dev',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }),
    json({ error: 'authorization_pending' }),
    json({ access_token: 'gho_secret', token_type: 'bearer', scope: 'repo' }),
    user,
  ];
  return { fetch: (async () => queue.shift()) as unknown as typeof fetch, now: () => 0, sleep: async () => true };
}

describe('signInWithGitHub', () => {
  beforeEach(() => fakeBrowser.reset());

  it('shows the code, then stores an oauth credential keyed host:login', async () => {
    let shown = '';
    const res = await signInWithGitHub(
      (c) => (shown = c.userCode),
      new AbortController().signal,
      fakeDeps(json({ login: 'octo', id: 1 })),
    );

    expect(shown).toBe('ABCD-1234');
    expect(res).toMatchObject({
      ok: true,
      value: { key: 'github.com:octo', kind: 'oauth', login: 'octo', scopes: ['repo'] },
    });
    expect(Object.keys(await loadCredentials())).toEqual(['github.com:octo']);
  });

  it('stores nothing if the token does not work', async () => {
    const res = await signInWithGitHub(() => {}, new AbortController().signal, fakeDeps(json({}, 401)));
    expect(res).toEqual({ ok: false, error: { code: 'invalid_token' } });
    expect(await loadCredentials()).toEqual({});
  });

  it('clearCredentials signs out', async () => {
    await signInWithGitHub(() => {}, new AbortController().signal, fakeDeps(json({ login: 'octo', id: 1 })));
    await clearCredentials();
    expect(await loadCredentials()).toEqual({});
  });
});
