import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Manifest is generated here. Every permission added must also get a
// justification in docs/store/listing.md, PRIVACY.md, and SPEC §11.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Explicit imports only: easier to read and grep than auto-imports.
  imports: false,
  manifest: {
    name: 'GitSync',
    description: 'Sync branches between GitHub repositories.',
    // 'offscreen' hosts the git-clone engine: sync runs can take minutes and the service worker is
    // terminated while idle, so isomorphic-git runs in an offscreen document instead (SPEC §14 rule 2).
    // 'activeTab' lets the panel read the URL of the tab the user had open when they clicked the toolbar
    // icon, to pre-select it as the source if it's a GitHub repo page. No broader tab access than that.
    permissions: ['sidePanel', 'storage', 'offscreen', 'activeTab'],
    // Device flow POSTs to github.com/login/*, which sends no CORS headers (SPEC §2, DECISIONS 0010).
    host_permissions: ['https://github.com/*'],
    action: { default_title: 'Open GitSync' },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
