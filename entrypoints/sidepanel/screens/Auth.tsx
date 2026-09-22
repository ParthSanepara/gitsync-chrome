import { Button, LinkButton, mutedTextClass, textLinkClass } from '../ui';
import type { AuthState } from '../useAuth';

interface Props {
  state: AuthState;
  onSignIn: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}

export function Auth({ state, onSignIn, onCancel, onSignOut }: Props) {
  switch (state.status) {
    case 'loading':
      return null;

    case 'signed-out':
      return (
        <section className="flex flex-col gap-3">
          <p className="text-sm">Connect your GitHub account to read the source repo and write the target.</p>
          {state.error && (
            <p role="alert" className="text-sm text-[#d1242f] dark:text-[#f85149]">
              {state.error}
            </p>
          )}
          <Button variant="primary" onClick={onSignIn}>
            Log in with GitHub
          </Button>
        </section>
      );

    case 'requesting-code':
      return <p className="text-sm">Contacting GitHub…</p>;

    case 'waiting':
      return (
        <section className="flex flex-col gap-3">
          <p className="text-sm">We opened github.com/login/device in a new tab. Enter this code there:</p>
          <p className="select-all rounded-md border border-slate-300 bg-slate-50 p-3 text-center font-mono text-2xl tracking-widest dark:border-slate-700 dark:bg-[#161b22]">
            {state.userCode}
          </p>
          <p className={mutedTextClass}>Waiting for approval…</p>
          <div className="flex items-center gap-3">
            <LinkButton variant="secondary" href={state.verificationUri} target="_blank" rel="noreferrer">
              Open the tab again
            </LinkButton>
            <button className={textLinkClass} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      );

    case 'signed-in':
      return (
        <section className="flex flex-col gap-2">
          <p className="text-sm">
            Signed in as <strong>{state.credential.login}</strong>
          </p>
          {state.notice && (
            <p role="alert" className="text-sm text-[#d1242f] dark:text-[#f85149]">
              {state.notice}
            </p>
          )}
          <button className={textLinkClass + ' self-start'} onClick={onSignOut}>
            Sign out
          </button>
        </section>
      );
  }
}
