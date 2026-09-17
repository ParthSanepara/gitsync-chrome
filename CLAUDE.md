# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GitSync is a Chrome MV3 extension that does one thing: sync branches between GitHub repositories. It has no backend.

**Read `docs/SPEC.md` before any architectural change. Do not deviate from it without updating it in the same PR.** Record architectural decisions in `docs/DECISIONS.md` (append-only).

## Status

M-1 foundation release: v0.1.0 in store review (`docs/plans/0002-foundation-release.md`). Roadmap to 1.0.0 and release steps: `docs/plans/0003-roadmap-to-stable.md`, tracked as GitHub milestones/issues. `spike/` holds the M0 experiment, parked. It is excluded from root lint/typecheck/CI.

## Docs

Every plan or design gets a Markdown file: plans in `docs/plans/NNNN-slug.md`, architecture/process in `docs/` (`SPEC.md`, `DECISIONS.md`, `RELEASING.md`).

## Commands

- `pnpm dev`: run with HMR in a WXT-launched Chrome
- `pnpm build` / `pnpm zip`: production build in `.output/chrome-mv3` / store zip
- `pnpm test`: vitest (`pnpm vitest run tests/sidePanel.test.ts` for one file)
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: all enforced in CI
- `pnpm icons`: re-render `public/icon/*.png` from `assets/icon.svg` (needs `rsvg-convert`)

## Conventions

- Import explicitly (`wxt/browser`, `wxt/utils/define-background`). WXT auto-imports are off. `@/` is the repo root.
- Tests use `fakeBrowser` from `wxt/testing/fake-browser`. Unmocked APIs (e.g. `sidePanel`) need `vi.spyOn`.
- PR titles are conventional commits (squash merge). release-please owns the version: never edit it by hand. See `docs/RELEASING.md`.
- Adding a manifest permission means also updating its justification in `docs/store/listing.md`, the list in `PRIVACY.md`, and SPEC §11.

## Rules (full text: SPEC §14)

1. Don't invent GitHub API endpoints, fields, or limits. Mark unknowns `// VERIFY:` and cover them with a fixture test.
2. No long-running work in the service worker. It goes in the offscreen document.
3. The planner owns engine selection. Engines never self-select, and UI never imports an engine.
4. `planner.ts` imports `Provider`, never the GitHub client.
5. Serialize all write requests to the GitHub API.
6. Every API response is parsed with zod before app code touches it.
7. Never log a token, even truncated, even in dev.
8. No features outside "Sync branches between GitHub repositories."
9. Failures are typed via the discriminated union in `src/errors.ts`. No bare `Error(string)`.
10. Tests use recorded fixtures. No live network in CI.

Credentials are per `host:owner` (`CredentialKey`), passed explicitly to every provider call. Tokens live only in `chrome.storage.session`. Never use `chrome.storage.sync`.
