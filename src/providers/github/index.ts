import type { z } from 'zod';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import type {
  BranchState,
  Commit,
  Credential,
  Provider,
  RateLimit,
  Ref,
  Repo,
  RepoRef,
  TreeEntry,
} from '@/src/providers/types';
import { GitHubClient } from './client';
import { blobResponse, commitResponse, refListItem, refResponse, repoResponse, treeResponse } from './schemas';

const seg = encodeURIComponent;
const commitLookup = commitResponse.pick({ sha: true });
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

  async getBranch(cred: Credential, repo: RepoRef, branch: string): Promise<Result<BranchState, ApiError>> {
    const path = `${repoPath(repo)}/git/ref/heads/${branch.split('/').map(seg).join('/')}`;
    const res = await this.client.get(cred, path, refResponse);
    if (res.ok) return ok({ state: 'exists', sha: res.value.object.sha });
    if (res.error.code === 'not_found') return ok({ state: 'missing' });
    // VERIFY against a real empty repo: SPEC §9 says this is a 409 "Git Repository is empty".
    if (res.error.code === 'conflict' && /empty/i.test(res.error.message)) return ok({ state: 'empty-repo' });
    return res;
  }

  async getTree(cred: Credential, repo: RepoRef, sha: string) {
    const res = await this.client.get(cred, `${repoPath(repo)}/git/trees/${seg(sha)}?recursive=1`, treeResponse);
    if (!res.ok) return res;
    const entries: TreeEntry[] = res.value.tree.map((t) => ({
      path: t.path,
      mode: t.mode,
      type: t.type,
      sha: t.sha,
      size: t.size,
    }));
    return ok({ entries, truncated: res.value.truncated });
  }

  async readBlobText(cred: Credential, repo: RepoRef, sha: string): Promise<Result<string, ApiError>> {
    const res = await this.client.get(cred, `${repoPath(repo)}/git/blobs/${seg(sha)}`, blobResponse);
    if (!res.ok) return res;
    if (res.value.encoding !== 'base64')
      return err({ code: 'unexpected_response', detail: `blob encoding ${res.value.encoding}` });
    const bytes = Uint8Array.from(atob(res.value.content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
    return ok(new TextDecoder().decode(bytes));
  }

  async canReachCommit(cred: Credential, repo: RepoRef, sha: string): Promise<Result<boolean, ApiError>> {
    const res = await this.client.get(cred, `${repoPath(repo)}/git/commits/${seg(sha)}`, commitLookup);
    if (res.ok) return ok(true);
    return res.error.code === 'not_found' ? ok(false) : res;
  }

  rateLimit(): RateLimit | undefined {
    return this.client.rateLimit;
  }
}
