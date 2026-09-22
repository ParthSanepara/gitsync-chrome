import { err, ok, type AuthError, type Result } from '@/src/errors';
import { userResponse } from './schemas';

export interface Identity {
  login: string;
  /** From the X-OAuth-Scopes header. Undefined if GitHub did not send it. VERIFY for OAuth App tokens. */
  scopes?: string[];
}

/** Who the token belongs to, and what it may do. Also proves the token still works. */
export async function fetchIdentity(
  token: string,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<Result<Identity, AuthError>> {
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 401) return err({ code: 'invalid_token' });
    if (!res.ok) return err({ code: 'unexpected_response', detail: `GET /user returned ${res.status}` });
    const parsed = userResponse.safeParse(await res.json());
    if (!parsed.success)
      return err({ code: 'unexpected_response', detail: 'user response did not match the expected shape' });
    const header = res.headers.get('x-oauth-scopes');
    const scopes =
      header === null
        ? undefined
        : header
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    return ok({ login: parsed.data.login, scopes });
  } catch (e) {
    return err({ code: 'network', message: e instanceof Error ? e.message : 'request failed' });
  }
}
