import type { AuthState } from '../useAuth';

interface Props {
  state: AuthState;
  onSignIn: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}

const button =
  'rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300';
const linkButton =
  'text-sm text-slate-600 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100';

export function Auth({ state, onSignIn, onCancel, onSignOut }: Props) {
  switch (state.status) {
    case 'loading':
      return null;

    case 'signed-out':
      return (
        <section className="flex flex-col gap-3">
          <p className="text-sm">Connect your GitHub account to read the source repo and write the target.</p>
          {state.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}
          <button className={button} onClick={onSignIn}>
            Log in with GitHub
          </button>
        </section>
      );

    case 'requesting-code':
      return <p className="text-sm">Contacting GitHub…</p>;

    case 'waiting':
      return (
        <section className="flex flex-col gap-3">
          <p className="text-sm">Enter this code on GitHub to approve access:</p>
          <p className="select-all rounded-md bg-slate-100 p-3 text-center font-mono text-2xl tracking-widest dark:bg-slate-800">
            {state.userCode}
          </p>
          <a className={button + ' text-center'} href={state.verificationUri} target="_blank" rel="noreferrer">
            Open github.com/login/device
          </a>
          <p className="text-xs text-slate-500">Waiting for approval…</p>
          <button className={linkButton} onClick={onCancel}>
            Cancel
          </button>
        </section>
      );

    case 'signed-in':
      return (
        <section className="flex flex-col gap-2">
          <p className="text-sm">
            Signed in as <strong>{state.login}</strong>
          </p>
          <button className={linkButton + ' self-start'} onClick={onSignOut}>
            Sign out
          </button>
        </section>
      );
  }
}
