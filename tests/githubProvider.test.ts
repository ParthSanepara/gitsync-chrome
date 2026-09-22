import { describe, expect, it } from 'vitest';
import { GitHubClient } from '@/src/providers/github/client';
import { GitHubProvider } from '@/src/providers/github';
import type { Credential } from '@/src/providers/types';

import commitFx from './fixtures/octocat-hello-world.commit.json';
import matchingRefsFx from './fixtures/octocat-hello-world.matching-refs.json';
import repoFx from './fixtures/octocat-hello-world.repo.json';
import tagsFx from './fixtures/actions-checkout.tags.json';

const fixtures: Record<string, unknown> = {
  'octocat-hello-world.repo.json': repoFx,
  'octocat-hello-world.commit.json': commitFx,
  'octocat-hello-world.matching-refs.json': matchingRefsFx,
  'actions-checkout.tags.json': tagsFx,
};
const fixture = (name: string): unknown => fixtures[name];
const cred: Credential = { key: 'github.com:octo', kind: 'oauth', token: 't', scopes: [], login: 'octo' };

function provider(routes: Record<string, unknown>) {
  const urls: string[] = [];
  const fetchMock = async (url: string) => {
    urls.push(url);
    const hit = Object.entries(routes).find(([path]) => url.endsWith(path));
    return new Response(JSON.stringify(hit ? hit[1] : { message: 'Not Found' }), { status: hit ? 200 : 404 });
  };
  const client = new GitHubClient({ fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, now: () => 0 });
  return { p: new GitHubProvider(client), urls };
}

const repo = { owner: 'octocat', name: 'Hello-World' };

describe('GitHubProvider (recorded responses)', () => {
  it('getRepo maps a repo response', async () => {
    const { p } = provider({ '/repos/octocat/Hello-World': fixture('octocat-hello-world.repo.json') });
    expect(await p.getRepo(cred, repo)).toEqual({
      ok: true,
      value: {
        owner: 'octocat',
        name: 'Hello-World',
        fullName: 'octocat/Hello-World',
        private: false,
        fork: false,
        archived: false,
        defaultBranch: 'master',
        sizeKb: 1,
        canPush: undefined,
      },
    });
  });

  it('getRepo reports not_found for a repo we cannot see', async () => {
    const { p } = provider({});
    expect(await p.getRepo(cred, repo)).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('listRepos filters by the search text', async () => {
    const one = fixture('octocat-hello-world.repo.json') as Record<string, unknown>;
    const other = { ...one, name: 'Other', full_name: 'octocat/Other' };
    const { p } = provider({ '/user/repos?per_page=100&sort=pushed': [one, other] });
    const all = await p.listRepos(cred, '');
    const filtered = await p.listRepos(cred, 'hello');
    expect(all.ok && all.value.map((r) => r.fullName)).toEqual(['octocat/Hello-World', 'octocat/Other']);
    expect(filtered.ok && filtered.value.map((r) => r.fullName)).toEqual(['octocat/Hello-World']);
  });

  it('listRepos surfaces canPush when permissions are present', async () => {
    const one = {
      ...(fixture('octocat-hello-world.repo.json') as object),
      permissions: { admin: false, push: true, pull: true },
    };
    const { p } = provider({ '/user/repos?per_page=100&sort=pushed': [one] });
    const res = await p.listRepos(cred, '');
    expect(res.ok && res.value[0]?.canPush).toBe(true);
  });

  it('listRefs returns branches then tags', async () => {
    const { p } = provider({
      '/repos/octocat/Hello-World/git/matching-refs/heads/': fixture('octocat-hello-world.matching-refs.json'),
      '/repos/octocat/Hello-World/tags?per_page=100': fixture('actions-checkout.tags.json'),
    });
    const res = await p.listRefs(cred, repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]).toEqual({ name: 'master', kind: 'branch', sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' });
    expect(res.value.filter((r) => r.kind === 'tag').length).toBeGreaterThan(0);
  });

  it('listRefs lists branches through matching-refs and strips refs/heads/', async () => {
    const { p, urls } = provider({
      '/repos/octocat/Hello-World/git/matching-refs/heads/': fixture('octocat-hello-world.matching-refs.json'),
      '/repos/octocat/Hello-World/tags?per_page=100': [],
    });
    const res = await p.listRefs(cred, repo);
    expect(res.ok && res.value.map((r) => r.name)).toEqual(['master', 'octocat-patch-1', 'test']);
    expect(urls.some((u) => u.includes('/branches'))).toBe(false);
  });

  it('resolveRef returns the commit, its tree and parents', async () => {
    const { p } = provider({ '/repos/octocat/Hello-World/commits/master': fixture('octocat-hello-world.commit.json') });
    const res = await p.resolveRef(cred, repo, 'master');
    expect(res).toMatchObject({
      ok: true,
      value: { sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d', treeSha: 'b4eecafa9be2f2006ce1b709d6857b07069b4608' },
    });
    expect(res.ok && res.value.parents).toHaveLength(2);
  });

  it('resolveRef encodes each path segment but keeps slashes', async () => {
    const { p, urls } = provider({});
    await p.resolveRef(cred, repo, 'feature/a b');
    expect(urls[0]).toBe('https://api.github.com/repos/octocat/Hello-World/commits/feature/a%20b');
  });

  it('resolveRef rejects an empty ref without calling GitHub', async () => {
    const { p, urls } = provider({});
    expect(await p.resolveRef(cred, repo, '  ')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(urls).toEqual([]);
  });
});

import refFx from './fixtures/octocat-hello-world.ref.json';
import treeFx from './fixtures/octocat-hello-world.tree.json';
import blobFx from './fixtures/octocat-hello-world.blob.json';

describe('GitHubProvider planning reads (recorded responses)', () => {
  const treeSha = 'b4eecafa9be2f2006ce1b709d6857b07069b4608';

  it('getBranch returns the tip sha', async () => {
    const { p } = provider({ '/git/ref/heads/master': refFx });
    expect(await p.getBranch(cred, repo, 'master')).toEqual({
      ok: true,
      value: { state: 'exists', sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' },
    });
  });

  it('getBranch reports a missing branch as data, not an error', async () => {
    const { p } = provider({});
    expect(await p.getBranch(cred, repo, 'nope')).toEqual({ ok: true, value: { state: 'missing' } });
  });

  it('getBranch reports an empty repository', async () => {
    const client = new GitHubClient({
      // VERIFY: the exact 409 body against a real empty repo.
      fetch: (async () =>
        new Response(JSON.stringify({ message: 'Git Repository is empty.' }), {
          status: 409,
        })) as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
    });
    expect(await new GitHubProvider(client).getBranch(cred, repo, 'main')).toEqual({
      ok: true,
      value: { state: 'empty-repo' },
    });
  });

  it('getTree returns entries with modes and sizes', async () => {
    const { p, urls } = provider({ [`/git/trees/${treeSha}?recursive=1`]: treeFx });
    expect(await p.getTree(cred, repo, treeSha)).toEqual({
      ok: true,
      value: {
        truncated: false,
        entries: [
          { path: 'README', mode: '100644', type: 'blob', sha: '980a0d5f19a64b4b30a87d4206aade58726b60e3', size: 13 },
        ],
      },
    });
    expect(urls[0]).toContain('recursive=1');
  });

  it('readBlobText decodes base64 content', async () => {
    const { p } = provider({ '/git/blobs/980a0d5f19a64b4b30a87d4206aade58726b60e3': blobFx });
    expect(await p.readBlobText(cred, repo, '980a0d5f19a64b4b30a87d4206aade58726b60e3')).toEqual({
      ok: true,
      value: 'Hello World!\n',
    });
  });

  it('canReachCommit is true on 200 and false on 404 (the fork-network probe)', async () => {
    const yes = provider({ '/git/commits/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d': commitFx });
    expect(await yes.p.canReachCommit(cred, repo, '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d')).toEqual({
      ok: true,
      value: true,
    });
    const no = provider({});
    expect(await no.p.canReachCommit(cred, repo, '0000000000000000000000000000000000000001')).toEqual({
      ok: true,
      value: false,
    });
  });

  it('canReachCommit passes real failures through', async () => {
    const client = new GitHubClient({
      fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
    });
    expect(await new GitHubProvider(client).canReachCommit(cred, repo, 'x')).toEqual({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });
});

describe('GitHubProvider writes', () => {
  function writer(response: unknown, status = 201) {
    const seen: Array<{ url: string; method?: string; body: unknown }> = [];
    const client = new GitHubClient({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify(response), { status });
      }) as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
    });
    return { p: new GitHubProvider(client), seen };
  }

  it('createBlob posts base64 and returns the sha', async () => {
    const { p, seen } = writer({ sha: 'abc' });
    expect(await p.createBlob(cred, repo, 'SGk=')).toEqual({ ok: true, value: 'abc' });
    expect(seen[0]).toEqual({
      url: 'https://api.github.com/repos/octocat/Hello-World/git/blobs',
      method: 'POST',
      body: { content: 'SGk=', encoding: 'base64' },
    });
  });

  it('createTree sends base_tree only when given, and null shas for deletions', async () => {
    const { p, seen } = writer({ sha: 't1' });
    await p.createTree(cred, repo, [{ path: 'gone', mode: '100644', type: 'blob', sha: null }], 'base1');
    await p.createTree(cred, repo, [{ path: 'a', mode: '100644', type: 'blob', sha: 'x' }]);
    expect(seen[0]?.body).toEqual({
      base_tree: 'base1',
      tree: [{ path: 'gone', mode: '100644', type: 'blob', sha: null }],
    });
    expect(seen[1]?.body).not.toHaveProperty('base_tree');
  });

  it('createCommit sends tree and parents', async () => {
    const { p, seen } = writer({ sha: 'c1' });
    expect(await p.createCommit(cred, repo, { message: 'm', treeSha: 't', parents: ['p'] })).toEqual({
      ok: true,
      value: 'c1',
    });
    expect(seen[0]?.body).toEqual({ message: 'm', tree: 't', parents: ['p'] });
  });

  it('createRef and updateRef target refs/heads/{branch}', async () => {
    const { p, seen } = writer({ ref: 'refs/heads/x', object: { sha: 's' } });
    await p.createRef(cred, repo, 'feature/x', 's');
    await p.updateRef(cred, repo, 'feature/x', 's', true);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/git\/refs$/),
      body: { ref: 'refs/heads/feature/x', sha: 's' },
    });
    expect(seen[1]).toMatchObject({
      method: 'PATCH',
      url: expect.stringMatching(/\/git\/refs\/heads\/feature\/x$/),
      body: { sha: 's', force: true },
    });
  });

  it('createFirstFile uses the Contents API and returns the commit and tree', async () => {
    const { p, seen } = writer({ commit: { sha: 'c', tree: { sha: 't' } } });
    expect(
      await p.createFirstFile(cred, repo, { path: 'a/b c.txt', base64: 'SGk=', message: 'Initial commit' }),
    ).toEqual({
      ok: true,
      value: { commitSha: 'c', treeSha: 't' },
    });
    expect(seen[0]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/contents\/a\/b%20c\.txt$/) });
  });

  it('readBlob strips whitespace from the base64 content', async () => {
    const { p } = writer({ content: 'SGVs\nbG8=\n', encoding: 'base64', size: 5 }, 200);
    expect(await p.readBlob(cred, repo, 'x')).toEqual({ ok: true, value: 'SGVsbG8=' });
  });

  it('surfaces a rejected write as a typed error', async () => {
    const { p } = writer({ message: 'Protected branch update failed' }, 422);
    expect(await p.updateRef(cred, repo, 'main', 's', false)).toEqual({
      ok: false,
      error: { code: 'validation', message: 'Protected branch update failed' },
    });
  });
});
