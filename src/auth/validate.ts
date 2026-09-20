import type { Credential } from '@/src/providers/types';
import { fetchIdentity } from '@/src/providers/github/user';

export type Validation =
  | { status: 'valid' }
  /** GitHub no longer accepts the token (revoked, expired, or the app was deauthorized). */
  | { status: 'revoked' }
  /** The token works but is not what we stored: another account, or different permissions. */
  | { status: 'changed'; reason: 'account' | 'scopes' }
  /** Could not tell (offline, GitHub down). Not a reason to sign the user out. */
  | { status: 'unknown' };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Run when the panel opens: a stored token is only as good as what GitHub says about it right now. */
export async function validateCredential(cred: Credential, fetchImpl?: typeof fetch): Promise<Validation> {
  const res = await fetchIdentity(cred.token, fetchImpl);
  if (!res.ok) return res.error.code === 'invalid_token' ? { status: 'revoked' } : { status: 'unknown' };
  if (res.value.login !== cred.login) return { status: 'changed', reason: 'account' };
  if (res.value.scopes && !sameSet(res.value.scopes, cred.scopes)) return { status: 'changed', reason: 'scopes' };
  return { status: 'valid' };
}
