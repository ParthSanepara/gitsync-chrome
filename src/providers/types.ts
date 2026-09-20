import type { ApiError, Result } from '@/src/errors';
export type ProviderId = 'github';

/** `${host}:${owner}` (SPEC §6.1). */
export type CredentialKey = `${string}:${string}`;

export interface Credential {
  key: CredentialKey;
  kind: 'pat' | 'oauth';
  token: string;
  scopes: string[];
  login: string;
  expiresAt?: number;
}

export interface RepoRef {
  owner: string;
  name: string;
}

export interface Repo extends RepoRef {
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  sizeKb?: number;
  /** Unknown when the API did not report permissions. */
  canPush?: boolean;
}

export interface Ref {
  name: string;
  kind: 'branch' | 'tag';
  sha: string;
}

export interface Commit {
  sha: string;
  treeSha: string;
  message: string;
  parents: string[];
}

export interface RateLimit {
  remaining: number;
  /** Epoch ms. */
  resetAt: number;
}

export interface TreeEntry {
  path: string;
  /** Git file mode, e.g. 100644, 100755, 040000, 160000 (submodule). */
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  /** Bytes. Present for blobs. */
  size?: number;
}

export type BranchState = { state: 'exists'; sha: string } | { state: 'missing' } | { state: 'empty-repo' };

/** Read side of a git host. Write methods arrive with the engines that need them (SPEC §5). */
export interface Provider {
  id: ProviderId;
  host: string;
  /** Repos the account can see, newest push first, filtered by `q`. */
  listRepos(cred: Credential, q: string): Promise<Result<Repo[], ApiError>>;
  /** Any repo the account can read, not just its own. */
  getRepo(cred: Credential, repo: RepoRef): Promise<Result<Repo, ApiError>>;
  listRefs(cred: Credential, repo: RepoRef): Promise<Result<Ref[], ApiError>>;
  resolveRef(cred: Credential, repo: RepoRef, ref: string): Promise<Result<Commit, ApiError>>;
  getBranch(cred: Credential, repo: RepoRef, branch: string): Promise<Result<BranchState, ApiError>>;
  /** Whole tree, recursive. `truncated` means the host cut it off. */
  getTree(
    cred: Credential,
    repo: RepoRef,
    sha: string,
  ): Promise<Result<{ entries: TreeEntry[]; truncated: boolean }, ApiError>>;
  readBlobText(cred: Credential, repo: RepoRef, sha: string): Promise<Result<string, ApiError>>;
  /**
   * Can a ref in `repo` point at this commit? True across a fork network, where the object is shared.
   * A probe, not an assumption (SPEC §8.1).
   */
  canReachCommit(cred: Credential, repo: RepoRef, sha: string): Promise<Result<boolean, ApiError>>;
  /** Last rate-limit headers seen, for budgeting. */
  rateLimit(): RateLimit | undefined;
}
