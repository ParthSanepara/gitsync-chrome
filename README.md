# gitsync-chrome

Sync branches between GitHub repositories.

A Chrome extension (Manifest V3, built with [WXT](https://wxt.dev)). Status: foundation release. The UI is a placeholder and sync features are not built yet.

## Develop

```sh
pnpm install
pnpm dev          # launches Chrome with the extension and HMR
pnpm test         # vitest
pnpm lint && pnpm typecheck
pnpm build        # production build in .output/chrome-mv3 (load unpacked)
```

## Docs

- [`docs/SPEC.md`](docs/SPEC.md): product and architecture specification
- [`docs/DECISIONS.md`](docs/DECISIONS.md): append-only decision log
- [`docs/plans/`](docs/plans): implementation plans
- [`docs/RELEASING.md`](docs/RELEASING.md): release pipeline and one-time store setup
- [`PRIVACY.md`](PRIVACY.md): privacy policy
