/** Typed failures (SPEC §14 rule 9). Add a variant here instead of throwing a bare Error. */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AuthError =
  | { code: 'network'; message: string }
  | { code: 'device_flow_disabled' }
  | { code: 'invalid_client' }
  | { code: 'device_code_expired' }
  | { code: 'access_denied' }
  | { code: 'cancelled' }
  | { code: 'invalid_token' }
  | { code: 'unexpected_response'; detail: string };

/** Text shown to the user. Never includes a token. */
export function describeAuthError(e: AuthError): string {
  switch (e.code) {
    case 'network':
      return `Could not reach GitHub: ${e.message}`;
    case 'device_flow_disabled':
      return 'Device flow is not enabled for this GitHub OAuth App. Enable it in the app settings.';
    case 'invalid_client':
      return 'GitHub rejected the OAuth App client ID.';
    case 'device_code_expired':
      return 'The code expired before it was approved. Start the login again.';
    case 'access_denied':
      return 'Access was denied on GitHub.';
    case 'cancelled':
      return 'Login cancelled.';
    case 'invalid_token':
      return 'GitHub no longer accepts this login. Sign in again.';
    case 'unexpected_response':
      return `Unexpected response from GitHub: ${e.detail}`;
  }
}

/** Failures from GitHub API calls. `message` is GitHub's own error text, never a token. */
export type ApiError =
  | { code: 'network'; message: string }
  | { code: 'cancelled' }
  | { code: 'unauthorized' }
  | { code: 'forbidden'; message: string }
  | { code: 'not_found' }
  | { code: 'conflict'; message: string }
  | { code: 'validation'; message: string }
  | { code: 'rate_limited'; resetAt: number }
  | { code: 'http'; status: number; message: string }
  | { code: 'unexpected_response'; detail: string };

export function describeApiError(e: ApiError): string {
  switch (e.code) {
    case 'network':
      return `Could not reach GitHub: ${e.message}`;
    case 'cancelled':
      return 'Cancelled.';
    case 'unauthorized':
      return 'GitHub no longer accepts this login. Sign in again.';
    case 'forbidden':
      return `GitHub denied access: ${e.message}`;
    case 'not_found':
      return 'Not found. The repository may not exist, or your account may not have access to it.';
    case 'conflict':
      return `GitHub reported a conflict: ${e.message}`;
    case 'validation':
      return `GitHub rejected the request: ${e.message}`;
    case 'rate_limited':
      return `GitHub rate limit reached. It resets at ${new Date(e.resetAt).toLocaleTimeString()}.`;
    case 'http':
      return `GitHub returned ${e.status}: ${e.message}`;
    case 'unexpected_response':
      return `Unexpected response from GitHub: ${e.detail}`;
  }
}
