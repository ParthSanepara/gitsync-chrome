import { useCallback, useEffect, useReducer, useRef } from 'react';
import { browser } from 'wxt/browser';
import { clearCredentials, loadCredentials } from '@/src/auth/store';
import { validateCredential } from '@/src/auth/validate';
import { signInWithGitHub } from '@/src/auth/login';
import type { DeviceCode } from '@/src/auth/device';
import type { Credential } from '@/src/providers/types';
import { describeAuthError } from '@/src/errors';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; error?: string }
  /** `previous` is set when an already signed-in user is asking for more permissions. */
  | { status: 'requesting-code'; previous?: Credential }
  | { status: 'waiting'; userCode: string; verificationUri: string; previous?: Credential }
  | { status: 'signed-in'; credential: Credential; notice?: string };

type Action =
  | { type: 'loaded'; credential: Credential | undefined }
  | { type: 'requesting'; previous?: Credential }
  | { type: 'code'; code: DeviceCode }
  | { type: 'signed-in'; credential: Credential }
  | { type: 'failed'; error?: string; previous?: Credential }
  | { type: 'signed-out' };

function reducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case 'loaded':
      return action.credential ? { status: 'signed-in', credential: action.credential } : { status: 'signed-out' };
    case 'requesting':
      return { status: 'requesting-code', previous: action.previous };
    case 'code':
      return {
        status: 'waiting',
        userCode: action.code.userCode,
        verificationUri: action.code.verificationUri,
        previous: state.status === 'requesting-code' ? state.previous : undefined,
      };
    case 'signed-in':
      return { status: 'signed-in', credential: action.credential };
    case 'failed':
      // Failing to add permissions must not sign the user out.
      return action.previous
        ? { status: 'signed-in', credential: action.previous, notice: action.error }
        : { status: 'signed-out', error: action.error };
    case 'signed-out':
      return { status: 'signed-out' };
  }
}

function describeInvalid(
  check: Exclude<Awaited<ReturnType<typeof validateCredential>>, { status: 'valid' | 'unknown' }>,
): string {
  if (check.status === 'revoked')
    return 'GitHub no longer accepts your saved login (it was revoked or expired). Sign in again.';
  return check.reason === 'account'
    ? 'Your saved login belongs to a different account than expected, so it was removed. Sign in again.'
    : 'The permissions on your saved login changed unexpectedly, so it was removed. Sign in again.';
}

export function useAuth() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const abort = useRef<AbortController | null>(null);

  // Set just before we clear the login ourselves, so the storage listener below does not report it as a surprise.
  const expectedClear = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const credential = Object.values(await loadCredentials())[0];
        if (!live) return;
        dispatch({ type: 'loaded', credential });
        if (!credential) return;

        // A stored token is only trusted as far as GitHub confirms it right now.
        const check = await validateCredential(credential);
        if (!live || check.status === 'valid' || check.status === 'unknown') return;
        await clearCredentials();
        dispatch({ type: 'failed', error: describeInvalid(check) });
      } catch {
        if (live) dispatch({ type: 'failed', error: 'Could not read the saved sign-in.' });
      }
    })();

    // The login can end while the panel is open: a 401, an extension update, or another panel signing out.
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' || !('credentials' in changes) || changes['credentials']?.newValue !== undefined) return;
      if (expectedClear.current) {
        expectedClear.current = false;
        return;
      }
      dispatch({
        type: 'failed',
        error: 'Your GitHub login ended (it expired, was revoked, or the extension updated). Sign in again.',
      });
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      live = false;
      browser.storage.onChanged.removeListener(onChanged);
      abort.current?.abort();
    };
  }, []);

  const signIn = useCallback(async (options?: { scope?: string; previous?: Credential }) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'requesting', previous: options?.previous });

    const result = await signInWithGitHub(
      (code) => {
        dispatch({ type: 'code', code });
        // Opens on its own so approving is one less click; the panel still shows a manual link in
        // case a popup blocker or window manager stops it.
        void browser.tabs.create({ url: code.verificationUri });
      },
      controller.signal,
      undefined,
      options?.scope,
    );
    if (result.ok) dispatch({ type: 'signed-in', credential: result.value });
    else if (result.error.code === 'cancelled') {
      dispatch(options?.previous ? { type: 'failed', previous: options.previous } : { type: 'signed-out' });
    } else dispatch({ type: 'failed', error: describeAuthError(result.error), previous: options?.previous });
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const signOut = useCallback(async () => {
    expectedClear.current = true;
    await clearCredentials();
    dispatch({ type: 'signed-out' });
  }, []);

  return { state, signIn, cancel, signOut };
}
