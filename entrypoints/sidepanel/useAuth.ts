import { useCallback, useEffect, useReducer, useRef } from 'react';
import { clearCredentials, loadCredentials } from '@/src/auth/store';
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

export function useAuth() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    loadCredentials()
      .then((all) => dispatch({ type: 'loaded', credential: Object.values(all)[0] }))
      .catch(() => dispatch({ type: 'failed', error: 'Could not read saved sign-in.' }));
    return () => abort.current?.abort();
  }, []);

  const signIn = useCallback(async (options?: { scope?: string; previous?: Credential }) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'requesting', previous: options?.previous });

    const result = await signInWithGitHub(
      (code) => dispatch({ type: 'code', code }),
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
    await clearCredentials();
    dispatch({ type: 'signed-out' });
  }, []);

  return { state, signIn, cancel, signOut };
}
