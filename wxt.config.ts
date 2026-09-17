import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Manifest is generated here. Every permission added must also get a
// justification in docs/RELEASING.md (store Privacy tab) and SPEC §11.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Explicit imports only: easier to read and grep than auto-imports.
  imports: false,
  manifest: {
    name: 'GitSync',
    description: 'Sync branches between GitHub repositories.',
    permissions: ['sidePanel'],
    action: { default_title: 'Open GitSync' },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
