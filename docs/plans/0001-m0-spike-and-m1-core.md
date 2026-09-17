# Plan 0001 — M0 spike and M1 headless core

- Date: 2026-09-17
- Status: Phase A done, Phase B built (spike/), experiments pending; M1 not started. Sequenced after plan 0002.

## Context

`gitsync-chrome` is empty (one-line README, placeholder CLAUDE.md). The user has written a full spec for a Chrome MV3 extension that syncs branches between GitHub repos with no backend. This plan turns that spec into ordered, gated work. Git branching, release, and store publishing are **deferred** (user will plan them after this). Until then, work stays on local `main` and nothing is pushed unless asked.

Toolchain on machine: Node 24, pnpm 12 (via corepack), Chrome at `/usr/bin/google-chrome`, `gh` CLI. Use **pnpm**.

The spec says M0 must pass before M1 starts. The plan follows that.

---

## Phase A — Docs foundation (one commit)

1. `docs/SPEC.md`: the spec verbatim.
2. `CLAUDE.md`: rewrite to stay short:
   - "Read `docs/SPEC.md` before any architectural change. Do not deviate from it without updating it in the same PR."
   - Condensed §14 rules (10 bullets, one line each).
   - Commands section (fill in as they appear: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm vitest run tests/x.test.ts`, `pnpm typecheck`).
3. `docs/DECISIONS.md`: append-only log with a fixed entry format (date, decision, context, consequence). First entries: "use pnpm"; "M0 is a framework-free spike".
4. `README.md`: title + the exact single-purpose sentence "Sync branches between GitHub repositories."
5. Commit: `docs: add project specification and decision log`.

## Phase B — M0 spike (gate)

Location: `spike/` (throwaway, deleted or archived once M1 starts; record in DECISIONS.md).

**Setup:** a bare MV3 extension. No WXT/React. esbuild bundles only `offscreen.ts` (isomorphic-git needs bundling and a `Buffer` polyfill). Load it unpacked.

- `spike/manifest.json`: permissions `offscreen`, `storage`; host_permissions `https://api.github.com/*`, `https://github.com/*`.
- `spike/background.js`: creates the offscreen doc (`reasons: ['WORKERS']`) and relays messages. It holds the PAT, typed into a tiny options page and kept in `chrome.storage.session`, and passes it to offscreen in the start message.
  - **Note:** offscreen docs only get `chrome.runtime`, not `chrome.storage`. So the token always travels by message. This affects the M1 design too; log it in DECISIONS.md.
- `spike/offscreen.ts`: experiment runners, triggered by message, with results logged to console and posted back.

**Experiments → acceptance criteria**

| #   | Experiment                                                                                              | Output                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `git.clone` small public repo via `isomorphic-git/http/web`, LightningFS, **no corsProxy**              | pass/fail + any header/Origin rejection details                                                                                |
| 2   | Add remote, `git.push` to a fresh empty repo with PAT `onAuth`                                          | pass/fail                                                                                                                      |
| 3   | Clone+push a ~50 MB repo                                                                                | wall time, peak JS heap (`performance.memory`) + Chrome Task Manager reading, IndexedDB usage (`navigator.storage.estimate()`) |
| 4   | `POST /git/blobs` with growing sizes (1, 10, 25, 50, 75, 100 MB)                                        | actual ceiling, error body at failure                                                                                          |
| 5   | Ref-copy: in own fork, `GET git/commits/{upstreamSha}`, then `POST git/refs` to an upstream-only commit | pass/fail, 404 vs 200 behavior for non-fork target                                                                             |
| 6   | Start exp. 3, stop the SW from `chrome://serviceworker-internals` mid-clone                             | clone completes? progress relay recovers on SW restart?                                                                        |

**Needs from the user:** a fine-grained PAT; a throwaway empty target repo; a fork of some upstream (exp. 5); a ~50 MB test repo choice.

**Deliverable:** `docs/DECISIONS.md` entries closing open questions 1, 2, 3, 6 with measured numbers, plus thresholds chosen (repo size block for git-clone, blob guardrail). If exp. 1/2 fail → record fallback to Actions-workflow engine and update SPEC §7/§8 before M1.

**Gate:** stop and review results with the user before Phase C.

## Phase C — M1 headless core

Scaffold with WXT (React-TS template), TS strict, Tailwind, vitest, zod, isomorphic-git, lightning-fs. Create the §10 layout. Only files M1 needs get real code; entrypoints are stubs.

Build order (each step has tests before the next):

1. `src/errors.ts`: discriminated union `SyncError | PlanWarning | PlanBlocker` covering every §9 row (codes + structured payloads, messages rendered later).
2. `src/providers/types.ts`: `Provider`, `Credential`, `CredentialKey`, `RepoRef`, `Ref`, `Commit`, `TreeEntry`, per §5/§6.1.
3. `src/providers/github/schemas.ts`: zod for repo, ref, commit, tree, blob, rate-limit headers. Unsure fields get a `// VERIFY:` comment.
4. `src/providers/github/client.ts`: fetch wrapper. Explicit credential per call, exponential backoff (respects `Retry-After`/`X-RateLimit-Reset`), rate-header tracking, **serialized write queue** with delay, read concurrency limit 4, token-redacting error paths, no logging of headers.
5. `src/providers/github/index.ts`: implements `Provider`, including the `sharesObjectStore` probe (metadata + `GET git/commits/{sha}`, trust probe).
6. `src/engines/types.ts`: `Engine { execute(plan, creds, onProgress, signal) }`, progress event union.
7. `src/engines/refCopy.ts` and `src/engines/treeReplay.ts` (snapshot: dedupe probe, chunked `base_tree`, create-first path for empty target).
8. `src/planner.ts`: imports `Provider` only. Engine selection per §7 order, estimates, blockers (rate budget, oversize blob from M0 threshold, LFS, archived, no push permission), warnings (submodules, SHA non-preservation, workflow permission need).
9. `src/auth/store.ts` + `pat.ts`: `chrome.storage.session` keyed by `host:owner`.
10. `src/messaging.ts`: typed channel. Minimal `background.ts` + `offscreen/main.ts` so a sync is drivable from the devtools console (`chrome.runtime.sendMessage({type:'plan'|'execute', ...})`).
11. Tests: `tests/fixtures/*.json` recorded once via a small `scripts/record-fixture.ts` (dev-only, run manually, strips auth headers). Test client backoff/rate tracking, schemas, planner selection matrix, and both engines against a mocked `fetch`.

## Phase D–F — outline only (re-plan in detail when reached)

- **M2 UI:** side panel screens Auth→Source→Target→Preview→Progress→Result; PAT permission checklist; cancel through `AbortSignal`.
- **M3:** profiles, filters/remap, PR mode, `lastN` in tree-replay, `gitClone.ts` engine (gated on M0), full error messages, content script button.
- **M4/M5:** store prep, device flow, alarms, optional host permissions. **Git branching/CI/release/publish plan is deferred to a separate planning session.**

---

## Verification

- **Phase A:** files exist; CLAUDE.md is under ~40 lines and points at SPEC.
- **Phase B:** each experiment's result is logged in the offscreen console and recorded in DECISIONS.md with numbers; the user reviews.
- **Phase C:** `pnpm typecheck` clean; `pnpm vitest run` green with no network (vitest setup fails any real `fetch`); `pnpm build` produces a loadable extension. Manual check: load unpacked, set PAT, run plan+execute from the SW console for (a) snapshot sync to an empty repo, (b) snapshot re-sync (confirm dedupe skips blobs), (c) ref-copy into a fork. Confirm no token appears in any console output.
