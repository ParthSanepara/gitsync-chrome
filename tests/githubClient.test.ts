import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GitHubClient, type ClientDeps } from '@/src/providers/github/client';
import type { Credential } from '@/src/providers/types';

const cred: Credential = {
  key: 'github.com:octo',
  kind: 'oauth',
  token: 'gho_secret_token',
  scopes: ['repo'],
  login: 'octo',
};
const item = z.object({ n: z.number() });

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init);

function setup(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
  const deps: ClientDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  };
  return { client: new GitHubClient(deps), fetchMock, sleeps };
}

describe('GitHubClient reads', () => {
  it('sends the explicit credential and parses the response', async () => {
    const { client, fetchMock } = setup(() => json({ n: 1 }));
    expect(await client.get(cred, '/x', item)).toEqual({ ok: true, value: { n: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/x');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_secret_token');
  });

  it('rejects a body that does not match the schema', async () => {
    const { client } = setup(() => json({ n: 'nope' }));
    expect(await client.get(cred, '/x', item)).toMatchObject({ ok: false, error: { code: 'unexpected_response' } });
  });

  it.each([
    [401, { code: 'unauthorized' }],
    [404, { code: 'not_found' }],
    [409, { code: 'conflict', message: 'boom' }],
    [422, { code: 'validation', message: 'boom' }],
    [403, { code: 'forbidden', message: 'boom' }],
    [418, { code: 'http', status: 418, message: 'boom' }],
  ])('maps HTTP %i', async (status, error) => {
    const { client } = setup(() => json({ message: 'boom' }, { status }));
    expect(await client.get(cred, '/x', item)).toEqual({ ok: false, error });
  });

  it('never puts the token in an error', async () => {
    const { client } = setup(() => json({ message: 'bad' }, { status: 500 }));
    const res = await client.get(cred, '/x', item);
    expect(JSON.stringify(res)).not.toContain('gho_secret_token');
  });

  it('retries a 503 with backoff, then succeeds', async () => {
    let calls = 0;
    const { client, sleeps } = setup(() => (++calls < 3 ? json({ message: 'down' }, { status: 503 }) : json({ n: 2 })));
    expect(await client.get(cred, '/x', item)).toEqual({ ok: true, value: { n: 2 } });
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after three failed attempts', async () => {
    const { client, fetchMock } = setup(() => json({ message: 'down' }, { status: 503 }));
    expect(await client.get(cred, '/x', item)).toMatchObject({ ok: false, error: { code: 'http', status: 503 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network failures on reads', async () => {
    let calls = 0;
    const { client } = setup(() => {
      if (++calls < 2) throw new TypeError('Failed to fetch');
      return json({ n: 3 });
    });
    expect(await client.get(cred, '/x', item)).toEqual({ ok: true, value: { n: 3 } });
  });

  it('tracks rate-limit headers', async () => {
    const { client } = setup(() =>
      json({ n: 1 }, { headers: { 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': '2000000' } }),
    );
    await client.get(cred, '/x', item);
    expect(client.rateLimit).toEqual({ remaining: 4990, resetAt: 2_000_000_000 });
  });

  it('reports an exhausted primary rate limit with its reset time', async () => {
    const { client } = setup(() =>
      json(
        { message: 'rate limit' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' } },
      ),
    );
    expect(await client.get(cred, '/x', item)).toEqual({
      ok: false,
      error: { code: 'rate_limited', resetAt: 9_999_999_999_000 },
    });
  });

  it('waits out a short Retry-After and retries', async () => {
    let calls = 0;
    const { client, sleeps } = setup(() =>
      ++calls === 1 ? json({ message: 'slow' }, { status: 403, headers: { 'retry-after': '2' } }) : json({ n: 4 }),
    );
    expect(await client.get(cred, '/x', item)).toEqual({ ok: true, value: { n: 4 } });
    expect(sleeps).toEqual([2000]);
  });

  it('does not wait out a long Retry-After', async () => {
    const { client, sleeps } = setup(() =>
      json({ message: 'slow' }, { status: 429, headers: { 'retry-after': '600' } }),
    );
    expect(await client.get(cred, '/x', item)).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(sleeps).toEqual([]);
  });

  it('caps concurrent reads at 4', async () => {
    let active = 0;
    let peak = 0;
    const { client } = setup(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({ n: 1 });
    });
    await Promise.all(Array.from({ length: 12 }, () => client.get(cred, '/x', item)));
    expect(peak).toBe(4);
  });
});

describe('GitHubClient pagination', () => {
  it('follows Link rel=next and stops at maxPages', async () => {
    const { client, fetchMock } = setup((url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? 1);
      return json([{ n: page }], { headers: { link: `<https://api.github.com/list?page=${page + 1}>; rel="next"` } });
    });
    const res = await client.getAll(cred, '/list', item, 3);
    expect(res).toEqual({ ok: true, value: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never follows a next link to another host (would leak the token)', async () => {
    const { client, fetchMock } = setup(() =>
      json([{ n: 1 }], { headers: { link: '<https://evil.example/x>; rel="next"' } }),
    );
    const res = await client.getAll(cred, '/list', item, 5);
    expect(res).toMatchObject({ ok: false, error: { code: 'unexpected_response' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('GitHubClient writes', () => {
  it('runs writes one at a time with a gap between them', async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const { client, sleeps } = setup(async (url) => {
      active++;
      peak = Math.max(peak, active);
      order.push(`start ${url}`);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({ n: 1 });
    });
    await Promise.all([1, 2, 3].map((i) => client.write(cred, 'POST', `/w${i}`, { a: i }, item)));
    expect(peak).toBe(1);
    expect(order).toEqual([
      'start https://api.github.com/w1',
      'start https://api.github.com/w2',
      'start https://api.github.com/w3',
    ]);
    expect(sleeps).toEqual([500, 500, 500]);
  });

  it('does not retry a write after a network failure', async () => {
    const { client, fetchMock } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await client.write(cred, 'POST', '/w', {}, item)).toMatchObject({ ok: false, error: { code: 'network' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the queue moving after a failed write', async () => {
    let calls = 0;
    const { client } = setup(() => (++calls === 1 ? json({ message: 'no' }, { status: 422 }) : json({ n: 1 })));
    const [a, b] = await Promise.all([
      client.write(cred, 'POST', '/a', {}, item),
      client.write(cred, 'POST', '/b', {}, item),
    ]);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
});

describe('GitHubClient 401 hook', () => {
  it('tells the app when GitHub rejects the token, and does not retry with it', async () => {
    const dead = vi.fn();
    const fetchMock = vi.fn(async () => json({ message: 'Bad credentials' }, { status: 401 }));
    const client = new GitHubClient(
      { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, now: () => 0 },
      { onUnauthorized: dead },
    );
    expect(await client.get(cred, '/x', item)).toEqual({ ok: false, error: { code: 'unauthorized' } });
    expect(dead).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
