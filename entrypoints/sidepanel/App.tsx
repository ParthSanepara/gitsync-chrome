import { browser } from 'wxt/browser';
import { Auth } from './screens/Auth';
import { Setup } from './screens/Setup';
import { useAuth } from './useAuth';

export function App() {
  const { version } = browser.runtime.getManifest();
  const { state, signIn, cancel, signOut } = useAuth();

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4 font-sans text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header>
        <h1 className="text-lg font-semibold">GitSync</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Sync branches between GitHub repositories.</p>
      </header>
      <Auth state={state} onSignIn={() => void signIn()} onCancel={cancel} onSignOut={() => void signOut()} />
      {state.status === 'signed-in' && <Setup credential={state.credential} />}
      <p className="mt-auto text-xs text-slate-500">v{version}</p>
    </main>
  );
}
