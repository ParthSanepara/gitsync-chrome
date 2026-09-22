import { ok, type AuthError, type Result } from '@/src/errors';
import { fetchIdentity } from '@/src/providers/github/user';
import type { Credential } from '@/src/providers/types';
import { CREDENTIAL_TTL_MS, GITHUB_CLIENT_ID, GITHUB_SCOPE } from './config';
import { defaultDeps, pollForToken, requestDeviceCode, type DeviceCode, type DeviceFlowDeps } from './device';
import { credentialKey, saveCredential } from './store';

/**
 * Whole login: code → user approves at github.com → token → identity → stored.
 * `onCode` fires once so the UI can show the code while we poll.
 */
export async function signInWithGitHub(
  onCode: (code: DeviceCode) => void,
  signal: AbortSignal,
  deps: DeviceFlowDeps = defaultDeps,
  /** Space-separated. Ask for more (e.g. `repo workflow`) only when a sync needs it. */
  scope: string = GITHUB_SCOPE,
): Promise<Result<Credential, AuthError>> {
  const code = await requestDeviceCode(GITHUB_CLIENT_ID, scope, deps);
  if (!code.ok) return code;
  onCode(code.value);

  const token = await pollForToken(GITHUB_CLIENT_ID, code.value, signal, deps);
  if (!token.ok) return token;

  const who = await fetchIdentity(token.value.token, deps.fetch);
  if (!who.ok) return who;

  const credential: Credential = {
    key: credentialKey(who.value.login),
    kind: 'oauth',
    token: token.value.token,
    scopes: token.value.scopes,
    login: who.value.login,
    expiresAt: deps.now() + CREDENTIAL_TTL_MS,
  };
  await saveCredential(credential);
  return ok(credential);
}
