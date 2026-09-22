import { browser } from 'wxt/browser';
import { Auth } from './screens/Auth';
import { Setup } from './screens/Setup';
import { useAuth } from './useAuth';

export function App() {
  const { version } = browser.runtime.getManifest();
  const { state, signIn, cancel, signOut } = useAuth();
  // While asking for more permissions the panel shows the code, but keeps the user's selections mounted.
  const credential = state.status === 'signed-in' ? state.credential : 'previous' in state ? state.previous : undefined;

  return (
    <main className="flex min-h-screen flex-col bg-white font-sans text-slate-900 dark:bg-[#0d1117] dark:text-slate-100">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h1 className="text-base font-semibold">GitSync</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">Sync branches between GitHub repositories.</p>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <Auth state={state} onSignIn={() => void signIn()} onCancel={cancel} onSignOut={() => void signOut()} />
        {credential && (
          <div hidden={state.status !== 'signed-in'}>
            <Setup
              credential={credential}
              onGrantWorkflow={() => void signIn({ scope: 'repo workflow', previous: credential })}
            />
          </div>
        )}
        <p className="mt-auto pt-2 text-xs text-slate-400 dark:text-slate-500">v{version}</p>
      </div>
    </main>
  );
}
