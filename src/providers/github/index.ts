import type { z } from 'zod';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import type {
  BranchState,
  Commit,
  Credential,
  RateLimit,
  Ref,
  Repo,
  RepoRef,
  TreeEntry,
  TreeWrite,
  WritableProvider,
} from '@/src/providers/types';
import { GitHubClient } from './client';
import {
  blobResponse,
  commitResponse,
  contentsPutResponse,
  matchingRefItem,
  pullRequestResponse,
  refListItem,
  refResponse,
  refWriteResponse,
  repoResponse,
  shaResponse,
  treeResponse,
} from './schemas';

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

export class GitHubProvider implements WritableProvider {
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
    // One unpaginated response with every branch; `/branches` stops at 100 per page. Recorded: 5,237 branches
    // of microsoft/vscode in one reply, no Link header. VERIFY: whether GitHub caps or paginates it past that.
    const branches = await this.client.getAll(cred, `${base}/git/matching-refs/heads/`, matchingRefItem, 5);
    if (!branches.ok) return branches;
    const tags = await this.client.getAll(cred, `${base}/tags?per_page=100`, refListItem, 2);
    if (!tags.ok) return tags;
    return ok([
      ...branches.value.map((b): Ref => ({
        name: b.ref.replace(/^refs\/heads\//, ''),
        kind: 'branch',
        sha: b.object.sha,
      })),
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

  async readBlob(cred: Credential, repo: RepoRef, sha: string): Promise<Result<string, ApiError>> {
    const res = await this.client.get(cred, `${repoPath(repo)}/git/blobs/${seg(sha)}`, blobResponse);
    if (!res.ok) return res;
    if (res.value.encoding !== 'base64')
      return err({ code: 'unexpected_response', detail: `blob encoding ${res.value.encoding}` });
    return ok(res.value.content.replace(/\s/g, ''));
  }

  async createBlob(cred: Credential, repo: RepoRef, base64: string): Promise<Result<string, ApiError>> {
    const res = await this.client.write(
      cred,
      'POST',
      `${repoPath(repo)}/git/blobs`,
      { content: base64, encoding: 'base64' },
      shaResponse,
    );
    return res.ok ? ok(res.value.sha) : res;
  }

  async createTree(
    cred: Credential,
    repo: RepoRef,
    entries: TreeWrite[],
    baseTree?: string,
  ): Promise<Result<string, ApiError>> {
    const body = { ...(baseTree ? { base_tree: baseTree } : {}), tree: entries };
    const res = await this.client.write(cred, 'POST', `${repoPath(repo)}/git/trees`, body, shaResponse);
    return res.ok ? ok(res.value.sha) : res;
  }

  async createCommit(
    cred: Credential,
    repo: RepoRef,
    commit: { message: string; treeSha: string; parents: string[] },
  ): Promise<Result<string, ApiError>> {
    const body = { message: commit.message, tree: commit.treeSha, parents: commit.parents };
    const res = await this.client.write(cred, 'POST', `${repoPath(repo)}/git/commits`, body, shaResponse);
    return res.ok ? ok(res.value.sha) : res;
  }

  async createRef(cred: Credential, repo: RepoRef, branch: string, sha: string): Promise<Result<void, ApiError>> {
    const res = await this.client.write(
      cred,
      'POST',
      `${repoPath(repo)}/git/refs`,
      { ref: `refs/heads/${branch}`, sha },
      refWriteResponse,
    );
    return res.ok ? ok(undefined) : res;
  }

  async updateRef(
    cred: Credential,
    repo: RepoRef,
    branch: string,
    sha: string,
    force: boolean,
  ): Promise<Result<void, ApiError>> {
    const path = `${repoPath(repo)}/git/refs/heads/${branch.split('/').map(seg).join('/')}`;
    const res = await this.client.write(cred, 'PATCH', path, { sha, force }, refWriteResponse);
    return res.ok ? ok(undefined) : res;
  }

  async createFirstFile(
    cred: Credential,
    repo: RepoRef,
    file: { path: string; base64: string; message: string },
  ): Promise<Result<{ commitSha: string; treeSha: string }, ApiError>> {
    const path = `${repoPath(repo)}/contents/${file.path.split('/').map(seg).join('/')}`;
    const res = await this.client.write(
      cred,
      'PUT',
      path,
      { message: file.message, content: file.base64 },
      contentsPutResponse,
    );
    return res.ok ? ok({ commitSha: res.value.commit.sha, treeSha: res.value.commit.tree.sha }) : res;
  }

  async openPullRequest(
    cred: Credential,
    repo: RepoRef,
    pr: { title: string; body: string; head: string; base: string },
  ): Promise<Result<{ url: string }, ApiError>> {
    const res = await this.client.write(cred, 'POST', `${repoPath(repo)}/pulls`, pr, pullRequestResponse);
    return res.ok ? ok({ url: res.value.html_url }) : res;
  }

  async findOpenPullRequest(
    cred: Credential,
    repo: RepoRef,
    head: string,
    base: string,
  ): Promise<Result<{ url: string } | undefined, ApiError>> {
    // The head filter needs `owner:branch`, and for a same-repo PR the owner is the repo owner.
    const query = `state=open&base=${seg(base)}&head=${seg(`${repo.owner}:${head}`)}`;
    const res = await this.client.getAll(cred, `${repoPath(repo)}/pulls?${query}`, pullRequestResponse, 1);
    if (!res.ok) return res;
    const first = res.value[0];
    return ok(first ? { url: first.html_url } : undefined);
  }
}
