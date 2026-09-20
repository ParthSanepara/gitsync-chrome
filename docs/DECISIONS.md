# Decisions

Append-only. Never edit or delete a past entry. To reverse a decision, add a new entry that supersedes it.

Entry format:

```
## NNNN — Title
- Date: YYYY-MM-DD
- Status: accepted | superseded by NNNN
- Context: why this came up
- Decision: what we chose
- Consequences: what follows from it
```

---

## 0001 — Use pnpm

- Date: 2026-09-17
- Status: accepted
- Context: Need one package manager for the project and CI.
- Decision: pnpm (via corepack).
- Consequences: Commit `pnpm-lock.yaml`. CI uses `pnpm install --frozen-lockfile`.

## 0002 — M0 is a framework-free spike in `spike/`

- Date: 2026-09-17
- Status: accepted
- Context: SPEC §12 requires validating the no-proxy git-over-HTTP bet before building anything.
- Decision: A bare MV3 extension in `spike/` with no WXT or React. esbuild is used only to bundle isomorphic-git into the offscreen document.
- Consequences: `spike/` is throwaway. It gets removed when M1 starts, and its measured results are recorded here.

## 0003 — Offscreen documents receive credentials by message

- Date: 2026-09-17
- Status: accepted
- Context: Offscreen documents only have access to `chrome.runtime`, not `chrome.storage`. Tokens live in `chrome.storage.session` (SPEC §6.4), so the engine host cannot read them directly.
- Decision: The service worker reads the needed credentials and includes them in the message that starts a sync. The offscreen document keeps them in memory for that sync only.
- Consequences: `src/messaging.ts` start-sync messages carry the source and target `Credential`s. Any offscreen logging must redact them. The spike already does this.

## 0004 — Trunk-based branching on a protected `main`

- Date: 2026-09-17
- Status: accepted (supersedes the `dev` branch in SPEC §13)
- Context: Plan 0002. A solo/small team gains nothing from a long-lived `dev` branch, and release-please works from the default branch.
- Decision: Short-lived branches → squash-merged PRs into protected `main`. The PR title must be a conventional commit.
- Consequences: Every commit on `main` is releasable and has a conventional message. Ruleset in `docs/RELEASING.md` §A.

## 0005 — Versioning and changelog via release-please

- Date: 2026-09-17
- Status: accepted
- Context: Chrome Web Store requires strictly increasing versions. Manual bumps are error-prone.
- Decision: release-please (node release type) owns `package.json` version and `CHANGELOG.md`. WXT derives the manifest version from `package.json`. Bootstrapped at `0.0.1`, so the first `feat:` release is `0.1.0`.
- Consequences: No manual version edits. release-please needs `RELEASE_PLEASE_TOKEN` (not `GITHUB_TOKEN`) so its PRs trigger CI.

## 0006 — Store publishing with `wxt submit`, API v2, service account

- Date: 2026-09-17
- Status: accepted
- Context: Chrome Web Store API v1.1 is being deprecated. In the bundled `publish-browser-extension` 6.1.1, API v2 authenticates only with a service account (client-ID/refresh-token flags are v1.1-only).
- Decision: The `release.yml` publish job runs `wxt submit` with `CHROME_API_VERSION=v2` and service-account credentials stored in the `chrome-web-store` GitHub Environment. A manual `store-dry-run.yml` checks credentials.
- Consequences: There is no refresh token to expire. The first item upload is manual, because the API cannot create items. Runbook: `docs/RELEASING.md`.

## 0007 — First store release is Unlisted

- Date: 2026-09-17
- Status: accepted
- Context: SPEC §12 M4 requires verifying the packaged build before going public.
- Decision: Item visibility Unlisted until M4 is signed off.
- Consequences: Installable by link only. Switching to Public is a dashboard setting and needs no new release.

## 0008 — Minimal permissions and tooling pins for the foundation release

- Date: 2026-09-17
- Status: accepted
- Context: Plan 0002 ships a UI-only extension. Tooling compatibility at scaffold time.
- Decision: Manifest permissions are `sidePanel` only. Host and other permissions are added with the features that need them. TypeScript is pinned to 6.0 (typescript-eslint 8 does not support TS 7), and vitest to 4 (the version WXT's test plugin is built against). WXT auto-imports are disabled in favour of explicit imports.
- Consequences: Revisit the pins when typescript-eslint and WXT support newer majors (Dependabot will surface them).

## 0009 — Repository stays private for now

- Date: 2026-09-17
- Status: accepted
- Context: On GitHub's free plan, private repos cannot use rulesets or branch protection, or GitHub Pages. Plan 0002 assumed both.
- Decision: Keep the repo private. Branch rules on `main` are conventions, not enforced. The privacy policy is published as a public Gist instead of GitHub Pages.
- Consequences: CI still runs on every PR, but merging with failing checks is technically possible, so don't. Revisit when the repo goes public or the plan is upgraded. The `docs/RELEASING.md` §A.2 and §D steps then switch back.

## 0010 — GitHub login (OAuth App device flow) is the primary auth, built first

- Date: 2026-09-20
- Status: accepted
- Context: The goal is to connect with a GitHub login and get read/write access from the account, instead of asking users for PATs. Standard OAuth needs a client secret, which an extension cannot hold. Fine-grained PATs are per-owner (SPEC §6.1). SPEC had device flow at M5 and PAT as the v1 method.
- Decision: Use OAuth App device flow as the default auth from the first sync UI. Request `repo`, and `workflow` only when a sync touches workflow files. The `client_id` is public and committed. PAT stays as a fallback. Tokens stay in `chrome.storage.session`. A GitHub App was considered and rejected for now: it needs a per-account or per-org install step.
- Consequences: Device flow needs the `https://github.com/*` host permission from the first login, so it is added to the published manifest. Existing installs see a new-permission prompt, so add it while the item is unlisted with few users. Orgs with app restrictions need owner approval. `repo` is coarse. Users log in again after a browser restart. SPEC §6, §11, §12 and §15 updated. M0 gains a device flow experiment. Adding the permission also means updating `docs/RELEASING.md` (CLAUDE.md rule).
