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
}
