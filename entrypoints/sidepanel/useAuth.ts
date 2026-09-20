import { useCallback, useEffect, useReducer, useRef } from 'react';
import { clearCredentials, loadCredentials } from '@/src/auth/store';
import { signInWithGitHub } from '@/src/auth/login';
import type { DeviceCode } from '@/src/auth/device';
import { describeAuthError } from '@/src/errors';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; error?: string }
  | { status: 'requesting-code' }
  | { status: 'waiting'; userCode: string; verificationUri: string }
  | { status: 'signed-in'; login: string };

type Action =
  | { type: 'loaded'; login: string | undefined }
  | { type: 'requesting' }
  | { type: 'code'; code: DeviceCode }
  | { type: 'signed-in'; login: string }
  | { type: 'failed'; error?: string }
  | { type: 'signed-out' };

function reducer(_: AuthState, action: Action): AuthState {
  switch (action.type) {
    case 'loaded':
      return action.login ? { status: 'signed-in', login: action.login } : { status: 'signed-out' };
    case 'requesting':
      return { status: 'requesting-code' };
    case 'code':
      return { status: 'waiting', userCode: action.code.userCode, verificationUri: action.code.verificationUri };
    case 'signed-in':
      return { status: 'signed-in', login: action.login };
    case 'failed':
      return { status: 'signed-out', error: action.error };
    case 'signed-out':
      return { status: 'signed-out' };
  }
}

export function useAuth() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    loadCredentials()
      .then((all) => dispatch({ type: 'loaded', login: Object.values(all)[0]?.login }))
      .catch(() => dispatch({ type: 'failed', error: 'Could not read saved sign-in.' }));
    return () => abort.current?.abort();
  }, []);

  const signIn = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'requesting' });

    const result = await signInWithGitHub((code) => dispatch({ type: 'code', code }), controller.signal);
    if (result.ok) dispatch({ type: 'signed-in', login: result.value.login });
    else if (result.error.code === 'cancelled') dispatch({ type: 'signed-out' });
    else dispatch({ type: 'failed', error: describeAuthError(result.error) });
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const signOut = useCallback(async () => {
    await clearCredentials();
    dispatch({ type: 'signed-out' });
  }, []);

  return { state, signIn, cancel, signOut };
}
