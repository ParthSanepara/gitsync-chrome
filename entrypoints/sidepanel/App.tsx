import { browser } from 'wxt/browser';

export function App() {
  const { version } = browser.runtime.getManifest();

  return (
    <main className="flex min-h-screen flex-col gap-2 p-4 font-sans text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <h1 className="text-lg font-semibold">GitSync</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">Sync branches between GitHub repositories.</p>
      <p className="mt-auto text-xs text-slate-500">v{version}</p>
    </main>
  );
}
