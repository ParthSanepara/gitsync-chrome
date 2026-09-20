import { err, ok, type AuthError, type Result } from '@/src/errors';
import { deviceCodeResponse, tokenResponse } from '@/src/providers/github/schemas';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface DeviceFlowDeps {
  fetch: typeof fetch;
  now: () => number;
  /** Resolves after `ms`, or early with `false` if aborted. */
  sleep: (ms: number, signal: AbortSignal) => Promise<boolean>;
}

export const defaultDeps: DeviceFlowDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
};

async function postForm(
  url: string,
  body: Record<string, string>,
  deps: DeviceFlowDeps,
): Promise<Result<unknown, AuthError>> {
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    return ok(await res.json());
  } catch (e) {
    return err({ code: 'network', message: e instanceof Error ? e.message : 'request failed' });
  }
}

/** Step 1: ask GitHub for a code the user types at github.com/login/device. */
export async function requestDeviceCode(
  clientId: string,
  scope: string,
  deps: DeviceFlowDeps = defaultDeps,
): Promise<Result<DeviceCode, AuthError>> {
  const res = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope }, deps);
  if (!res.ok) return res;

  const parsed = deviceCodeResponse.safeParse(res.value);
  if (parsed.success) {
    const d = parsed.data;
    return ok({
      deviceCode: d.device_code,
      userCode: d.user_code,
      verificationUri: d.verification_uri,
      expiresAt: deps.now() + d.expires_in * 1000,
      intervalSeconds: d.interval,
    });
  }
  const failure = tokenResponse.safeParse(res.value);
  if (failure.success && 'error' in failure.data) return err(mapTokenError(failure.data.error));
  return err({ code: 'unexpected_response', detail: 'device code response did not match the expected shape' });
}

function mapTokenError(code: string): AuthError {
  switch (code) {
    case 'expired_token':
      return { code: 'device_code_expired' };
    case 'access_denied':
      return { code: 'access_denied' };
    case 'device_flow_disabled':
      return { code: 'device_flow_disabled' };
    case 'incorrect_client_credentials':
      return { code: 'invalid_client' };
    default:
      return { code: 'unexpected_response', detail: code };
  }
}

/** Step 2: poll until the user approves. Honours `interval`, and slows down on `slow_down`. */
export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  signal: AbortSignal,
  deps: DeviceFlowDeps = defaultDeps,
): Promise<Result<{ token: string; scopes: string[] }, AuthError>> {
  let intervalMs = code.intervalSeconds * 1000;

  while (deps.now() < code.expiresAt) {
    if (!(await deps.sleep(intervalMs, signal))) return err({ code: 'cancelled' });

    const res = await postForm(
      ACCESS_TOKEN_URL,
      { client_id: clientId, device_code: code.deviceCode, grant_type: GRANT_TYPE },
      deps,
    );
    if (!res.ok) return res;

    const parsed = tokenResponse.safeParse(res.value);
    if (!parsed.success)
      return err({ code: 'unexpected_response', detail: 'token response did not match the expected shape' });

    const body = parsed.data;
    if ('access_token' in body) {
      return ok({ token: body.access_token, scopes: body.scope ? body.scope.split(',') : [] });
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      intervalMs = body.interval ? body.interval * 1000 : intervalMs + 5000;
      continue;
    }
    return err(mapTokenError(body.error));
  }
  return err({ code: 'device_code_expired' });
}
