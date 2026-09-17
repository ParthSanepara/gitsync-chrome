# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GitSync is a Chrome MV3 extension that does one thing: sync branches between GitHub repositories. It has no backend.

**Read `docs/SPEC.md` before any architectural change. Do not deviate from it without updating it in the same PR.** Record architectural decisions in `docs/DECISIONS.md` (append-only).

## Status

Milestone M0 (framework-free spike in `spike/`) is in progress. The WXT app has not been scaffolded yet. Do not start M1 until M0 passes (SPEC §12).

## Commands

Package manager: pnpm. Commands are added here as they come into existence.

- M0 spike: `cd spike && pnpm install && pnpm build`, then load `spike/dist` unpacked. See `spike/README.md`.

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
