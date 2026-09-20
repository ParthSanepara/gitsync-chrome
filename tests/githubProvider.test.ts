import { describe, expect, it } from 'vitest';
import { GitHubClient } from '@/src/providers/github/client';
import { GitHubProvider } from '@/src/providers/github';
import type { Credential } from '@/src/providers/types';

import branchesFx from './fixtures/octocat-hello-world.branches.json';
import commitFx from './fixtures/octocat-hello-world.commit.json';
import repoFx from './fixtures/octocat-hello-world.repo.json';
import tagsFx from './fixtures/actions-checkout.tags.json';

const fixtures: Record<string, unknown> = {
  'octocat-hello-world.repo.json': repoFx,
  'octocat-hello-world.branches.json': branchesFx,
  'octocat-hello-world.commit.json': commitFx,
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
      '/repos/octocat/Hello-World/branches?per_page=100': fixture('octocat-hello-world.branches.json'),
      '/repos/octocat/Hello-World/tags?per_page=100': fixture('actions-checkout.tags.json'),
    });
    const res = await p.listRefs(cred, repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]).toEqual({ name: 'master', kind: 'branch', sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' });
    expect(res.value.filter((r) => r.kind === 'tag').length).toBeGreaterThan(0);
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
