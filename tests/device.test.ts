import { describe, expect, it, vi } from 'vitest';
import { pollForToken, requestDeviceCode, type DeviceCode, type DeviceFlowDeps } from '@/src/auth/device';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function deps(responses: Response[]): DeviceFlowDeps & { sleeps: number[]; fetch: ReturnType<typeof vi.fn> } {
  let t = 0;
  const sleeps: number[] = [];
  const fetchMock = vi.fn(async () => responses.shift() ?? json({ error: 'expired_token' }));
  return {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return true;
    },
    sleeps,
  } as unknown as DeviceFlowDeps & { sleeps: number[]; fetch: ReturnType<typeof vi.fn> };
}

const code: DeviceCode = {
  deviceCode: 'dev',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresAt: 900_000,
  intervalSeconds: 5,
};

describe('requestDeviceCode', () => {
  it('parses a device code response', async () => {
    const d = deps([
      json({
        device_code: 'dev',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 899,
        interval: 5,
      }),
    ]);
    const res = await requestDeviceCode('cid', 'repo', d);
    expect(res).toMatchObject({ ok: true, value: { userCode: 'ABCD-1234', intervalSeconds: 5, expiresAt: 899_000 } });
  });

  it('maps device_flow_disabled', async () => {
    const res = await requestDeviceCode('cid', 'repo', deps([json({ error: 'device_flow_disabled' })]));
    expect(res).toEqual({ ok: false, error: { code: 'device_flow_disabled' } });
  });

  it('reports a shape mismatch instead of trusting the body', async () => {
    const res = await requestDeviceCode('cid', 'repo', deps([json({ nope: true })]));
    expect(res).toMatchObject({ ok: false, error: { code: 'unexpected_response' } });
  });

  it('reports network failures', async () => {
    const d = deps([]);
    d.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await requestDeviceCode('cid', 'repo', d)).toEqual({
      ok: false,
      error: { code: 'network', message: 'Failed to fetch' },
    });
  });
});

describe('pollForToken', () => {
  const ctl = () => new AbortController().signal;

  it('waits through authorization_pending, then returns the token and scopes', async () => {
    const d = deps([
      json({ error: 'authorization_pending' }),
      json({ error: 'authorization_pending' }),
      json({ access_token: 'gho_x', token_type: 'bearer', scope: 'repo,workflow' }),
    ]);
    const res = await pollForToken('cid', code, ctl(), d);
    expect(res).toEqual({ ok: true, value: { token: 'gho_x', scopes: ['repo', 'workflow'] } });
    expect(d.sleeps).toEqual([5000, 5000, 5000]);
  });

  it('slows down: uses the interval GitHub returns, else adds 5s', async () => {
    const d = deps([
      json({ error: 'slow_down', interval: 10 }),
      json({ error: 'slow_down' }),
      json({ access_token: 't', token_type: 'bearer', scope: '' }),
    ]);
    const res = await pollForToken('cid', code, ctl(), d);
    expect(res).toEqual({ ok: true, value: { token: 't', scopes: [] } });
    expect(d.sleeps).toEqual([5000, 10_000, 15_000]);
  });

  it.each([
    ['access_denied', 'access_denied'],
    ['expired_token', 'device_code_expired'],
    ['incorrect_client_credentials', 'invalid_client'],
  ])('maps %s to %s', async (githubError, ourCode) => {
    const res = await pollForToken('cid', code, ctl(), deps([json({ error: githubError })]));
    expect(res).toEqual({ ok: false, error: { code: ourCode } });
  });

  it('gives up when the code expires locally', async () => {
    const d = deps(Array.from({ length: 500 }, () => json({ error: 'authorization_pending' })));
    const res = await pollForToken('cid', { ...code, expiresAt: 12_000 }, ctl(), d);
    expect(res).toEqual({ ok: false, error: { code: 'device_code_expired' } });
  });

  it('returns cancelled when aborted', async () => {
    const d = deps([]);
    d.sleep = async () => false;
    expect(await pollForToken('cid', code, ctl(), d)).toEqual({ ok: false, error: { code: 'cancelled' } });
  });

  it('sends the device-code grant type', async () => {
    const d = deps([json({ access_token: 't', token_type: 'bearer', scope: '' })]);
    await pollForToken('cid', code, ctl(), d);
    const init = d.fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as URLSearchParams).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });
});
