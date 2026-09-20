import { ok, type AuthError, type Result } from '@/src/errors';
import { fetchLogin } from '@/src/providers/github/user';
import type { Credential } from '@/src/providers/types';
import { GITHUB_CLIENT_ID, GITHUB_SCOPE } from './config';
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
): Promise<Result<Credential, AuthError>> {
  const code = await requestDeviceCode(GITHUB_CLIENT_ID, GITHUB_SCOPE, deps);
  if (!code.ok) return code;
  onCode(code.value);

  const token = await pollForToken(GITHUB_CLIENT_ID, code.value, signal, deps);
  if (!token.ok) return token;

  const login = await fetchLogin(token.value.token, deps.fetch);
  if (!login.ok) return login;

  const credential: Credential = {
    key: credentialKey(login.value),
    kind: 'oauth',
    token: token.value.token,
    scopes: token.value.scopes,
    login: login.value,
  };
  await saveCredential(credential);
  return ok(credential);
}
