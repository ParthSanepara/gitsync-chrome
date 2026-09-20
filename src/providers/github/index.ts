import type { z } from 'zod';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import type { Commit, Credential, Provider, Ref, Repo, RepoRef } from '@/src/providers/types';
import { GitHubClient } from './client';
import { commitResponse, refListItem, repoResponse } from './schemas';

const seg = encodeURIComponent;
const repoPath = (r: RepoRef) => `/repos/${seg(r.owner)}/${seg(r.name)}`;

function toRepo(r: z.infer<typeof repoResponse>): Repo {
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    defaultBranch: r.default_branch,
    sizeKb: r.size,
    canPush: r.permissions?.push,
  };
}

export class GitHubProvider implements Provider {
  readonly id = 'github' as const;
  readonly host = 'api.github.com';

  constructor(private readonly client: GitHubClient = new GitHubClient()) {}

  async listRepos(cred: Credential, q: string): Promise<Result<Repo[], ApiError>> {
    const res = await this.client.getAll(cred, '/user/repos?per_page=100&sort=pushed', repoResponse, 5);
    if (!res.ok) return res;
    const needle = q.trim().toLowerCase();
    const repos = res.value.map(toRepo);
    return ok(needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos);
  }

  async getRepo(cred: Credential, repo: RepoRef): Promise<Result<Repo, ApiError>> {
    const res = await this.client.get(cred, repoPath(repo), repoResponse);
    return res.ok ? ok(toRepo(res.value)) : res;
  }

  async listRefs(cred: Credential, repo: RepoRef): Promise<Result<Ref[], ApiError>> {
    const base = repoPath(repo);
    const branches = await this.client.getAll(cred, `${base}/branches?per_page=100`, refListItem, 5);
    if (!branches.ok) return branches;
    const tags = await this.client.getAll(cred, `${base}/tags?per_page=100`, refListItem, 2);
    if (!tags.ok) return tags;
    return ok([
      ...branches.value.map((b): Ref => ({ name: b.name, kind: 'branch', sha: b.commit.sha })),
      ...tags.value.map((t): Ref => ({ name: t.name, kind: 'tag', sha: t.commit.sha })),
    ]);
  }

  async resolveRef(cred: Credential, repo: RepoRef, ref: string): Promise<Result<Commit, ApiError>> {
    if (!ref.trim()) return err({ code: 'validation', message: 'ref is empty' });
    // VERIFY: branch names containing "/" resolve through this path with each segment encoded.
    const path = `${repoPath(repo)}/commits/${ref.split('/').map(seg).join('/')}`;
    const res = await this.client.get(cred, path, commitResponse);
    if (!res.ok) return res;
    const c = res.value;
    return ok({
      sha: c.sha,
      treeSha: c.commit.tree.sha,
      message: c.commit.message,
      parents: c.parents.map((p) => p.sha),
    });
  }
}
