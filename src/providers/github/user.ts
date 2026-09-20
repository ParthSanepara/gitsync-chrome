import { err, ok, type AuthError, type Result } from '@/src/errors';
import { userResponse } from './schemas';

/** Who the token belongs to. Also proves the token works. */
export async function fetchLogin(
  token: string,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<Result<string, AuthError>> {
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 401) return err({ code: 'invalid_token' });
    if (!res.ok) return err({ code: 'unexpected_response', detail: `GET /user returned ${res.status}` });
    const parsed = userResponse.safeParse(await res.json());
    if (!parsed.success)
      return err({ code: 'unexpected_response', detail: 'user response did not match the expected shape' });
    return ok(parsed.data.login);
  } catch (e) {
    return err({ code: 'network', message: e instanceof Error ? e.message : 'request failed' });
  }
}
