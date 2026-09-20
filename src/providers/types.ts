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
