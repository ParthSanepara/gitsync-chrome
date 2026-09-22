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

## 0011 — Device-flow polling runs in the side panel

- Date: 2026-09-20
- Status: accepted
- Context: SPEC §14 rule 2 keeps long-running work out of the service worker. Login polling lasts up to 15 minutes but only matters while the user is looking at the code.
- Decision: The side panel runs the device-flow login (request code, poll, fetch identity, store credential). It is an extension page, so it can call `github.com/login/*` under the host permission and write `chrome.storage.session`. No offscreen document is needed for auth.
- Consequences: Closing the panel cancels an in-progress login. Sync engines still run in the offscreen document. Only `https://github.com/*` is added to `host_permissions`; `api.github.com` sends CORS headers, so its host permission waits for a feature that needs it.

## 0012 — Snapshot sync runs in the side panel for now

- Date: 2026-09-20
- Status: accepted
- Context: SPEC §4 runs engines in an offscreen document so a long sync survives the UI closing. The tree-replay engine is REST-only: minutes at most, no heavy memory, and the user is watching the panel.
- Decision: The side panel calls the runner directly (`src/runner.ts`). The offscreen document arrives with the git-clone engine or scheduled syncs, whichever needs it first. The planner and engines depend only on `Provider`/`WritableProvider` and an `AbortSignal`, so moving them is a change of caller, not of code.
- Consequences: Closing the panel mid-sync cancels it, and the UI says so. The target branch moves last, so a cancelled run leaves the branch untouched (orphan blobs are harmless). Rule 2 (no long work in the service worker) still holds.

## 0013 — Ask for `repo workflow` at login

- Date: 2026-09-20
- Status: accepted (supersedes the "workflow on demand" part of 0010)
- Context: 0010 requested `repo` and asked for `workflow` only when a sync touched `.github/workflows`. In use, that meant a second device-flow approval in the middle of a sync, right after the first.
- Decision: The login requests `repo workflow` in one approval. The "Grant workflow permission" button stays as a fallback for a login that lacks it.
- Consequences: The consent screen is broader up front, which SPEC §6.2 warned can deter users. The user chose one approval over the narrower first prompt. `workflow` lets a token change GitHub Actions files in any repo the user can write, so it makes the stored token (0014) more valuable to steal.

## 0014 — Keep the login for seven days

- Date: 2026-09-20
- Status: accepted (supersedes "tokens only in `chrome.storage.session`" in SPEC §6.4 and CLAUDE.md)
- Context: Session storage is cleared when the browser closes, so the user signed in again on every restart.
- Decision: Store the credential in `chrome.storage.local` with an absolute 7-day expiry. Drop it on: expiry, a missing or implausible expiry, malformed data, GitHub answering 401, a different account or scopes reported on open, an extension update, or sign out. Uninstalling deletes the storage.
- Consequences: The token now sits on disk unencrypted. Anything with access to the browser profile can read it, and it carries `workflow` (0013). Detection is limited to the checks above. There is no way to notice "unwanted activity" on GitHub from inside the extension, and no revoke call without a client secret, so a user who suspects misuse must revoke at github.com/settings/applications. `chrome.storage.sync` stays forbidden.

## 0015 — Whole-repository sync is a batch of per-branch syncs

- Date: 2026-09-20
- Status: accepted
- Context: Users want to sync a whole repository, not one branch at a time.
- Decision: "Entire repository" lists the source's branches and runs the existing per-branch plan and engines once per branch, into the same-named target branch. Each branch is planned again right before it runs. Tags are not synced and nothing is deleted from the target. New branches start from the target's default branch (or the PR base), not as parentless commits. Pull-request mode is single-branch only.
- Consequences: No new engine, so no new place for the two paths to disagree. The cost is API calls: every branch is planned twice, so a cap of 100 branches applies. A sync interrupted midway leaves some branches done, and running it again finishes the rest (finished branches report "up to date").

## 0016 — git-clone engine ships ahead of a completed M0 spike

- Date: 2026-09-22
- Status: accepted
- Context: A full-history sync between two repos with no shared fork network hit `engine_unavailable`: git-clone was speced (SPEC §8.3) but not built, and SPEC §12 gates M1+ on M0 (`spike/`) passing first. `spike/` was built (DECISIONS 0002) but never run to completion: SPEC §15 Q1-Q3 (does clone+push work with no CORS proxy, the practical repo-size ceiling, the real `POST git/blobs` limit) are still open, the same way `MAX_BLOB_BYTES` in `planner.ts` already shipped as a VERIFY-tagged guess rather than a spike-measured number. The user asked directly for the engine, and the offscreen document was already anticipated as arriving with it (DECISIONS 0012).
- Decision: Implement the real engine now rather than block on running the browser spike interactively: `entrypoints/offscreen/` (an unlisted WXT page hosting isomorphic-git + `@isomorphic-git/lightning-fs`) plus `src/engines/gitClone.ts`, `src/messaging.ts`, and `src/offscreenClient.ts` for the typed port protocol between the side panel and that document. `entrypoints/background.ts` owns creating the offscreen document (only one may exist) in response to an `ensure-offscreen` message. The planner's guardrails (`checkGitCloneGuardrails` in `planner.ts`) are the safety net in place of measured numbers: `GIT_CLONE_MAX_REPO_KB` (a VERIFY-tagged 500 MB placeholder for SPEC §15 Q2) and an LFS scan reusing the same `.gitattributes` heuristic as tree-replay (SPEC §8.3's "must never happen" pointer-without-object case). Auth uses `x-access-token` as the git-over-HTTPS username for both PAT and OAuth tokens (SPEC §15 Q1, untested against a real fine-grained PAT). `spike/` is left in place rather than deleted (DECISIONS 0002 said it would be removed "when M1 starts"): it is still the fastest way to actually measure Q1-Q3 against real repositories.
- Consequences: The size ceiling and the auth form are unverified guesses, not measured limits — exactly the situation `// VERIFY:` comments in `planner.ts` and `entrypoints/offscreen/main.ts` are for. A repo just under the ceiling could still exceed the offscreen document's IndexedDB quota or peak memory in practice; that failure now surfaces as a `clone_failed`/`push_failed` `SyncError` at run time instead of a blocker at plan time. Cancellation is best-effort: honoured before the clone starts and before the push starts, not mid-transfer, because a git push is one atomic operation on the server side. `entrypoints/offscreen/main.ts`'s isomorphic-git calls are not covered by the vitest suite (rule 10 forbids live network in CI, and there is no way to fixture a real git smart-HTTP exchange); `spike/`'s manual experiments remain the only way to validate them against a real GitHub repo before this ships to real users.

## 0017 — `activeTab`, not `tabs`, for pre-selecting the source repo

- Date: 2026-09-23
- Status: accepted
- Context: The panel now offers the tab open when it was invoked as the source repo, to save a manual search when the user is already looking at the repo on github.com. Reading a tab's URL needs either `tabs` (every tab, at any time, no gesture required — a broad, standing-access permission that store review scrutinizes heavily, the same category §11 already avoids for `https://github.com/*`) or `activeTab` (only the tab active at the moment the user invokes the extension, and only until they navigate away).
- Decision: Use `activeTab`. The side panel opens via `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` bound to the toolbar icon, which is exactly the user gesture `activeTab` is granted on. `Setup.tsx` reads `browser.tabs.query({ active: true, currentWindow: true })` once on mount and parses the URL with `parseGitHubRepoUrl` (`src/providers/github/repoUrl.ts`); a non-repo tab, or a tab the URL can't be read from, is silently ignored — this is a convenience, never a blocker.
- Consequences: The pre-fill only reflects the tab active at the moment the panel was opened by clicking the action button; if the panel was already open and the user switches to a different GitHub repo tab, it will not update without reopening the panel. That is the correct tradeoff for the minimal permission grant, and matches what the user asked for ("if user open our extension"). Never overwrites a repo the user already picked, including one picked while the lookup was still in flight (checked via a functional `setState` update, not a stale closure).

## 0018 — Branches are listed through `git/matching-refs`, and picked with a searchable field

- Date: 2026-09-23
- Status: accepted
- Context: `listRefs` read `GET /repos/{o}/{r}/branches?per_page=100` for at most 5 pages. On a repo with about 2,050 branches it stopped at 500, alphabetically, so the default branch (`main`) was not in the list. The `<select>` then had no option matching its value and showed the first branch instead, and the missing branches could not be picked at all. The same cut-off also hid branches from the planner's name-conflict check and understated the branch count that whole-repository sync reports.
- Decision: List branches with `GET /repos/{o}/{r}/git/matching-refs/heads/` (empty prefix). A recorded reply for microsoft/vscode held all 5,237 branches in one response with no `Link` header; the client still follows `Link` if GitHub ever adds one. Tags keep using `/tags`. The side panel's branch `<select>` becomes a combobox: it shows the selected name and a "default" badge, lists the default branch first, filters the full list as the user types (rendering at most 50 rows), and on the target side offers "Create branch …" for a typed name that does not exist.
- Consequences: One request instead of up to five, and no ceiling in practice. The response for a very large repo is a few MB, parsed once per picker mount. Whether GitHub caps or paginates `matching-refs` beyond the recorded size is unverified (`// VERIFY:` in `src/providers/github/index.ts`).

## 0019 — A frozen `release/vX.Y.Z` branch per release

- Date: 2026-09-23
- Status: accepted
- Context: Releases are tracked only as `vX.Y.Z` tags. The owner wants each shipped version also visible as its own branch, left untouched, so every release can be browsed and compared from the branch list.
- Decision: After release-please creates a release, a `release-branch` job in `release.yml` creates `release/vX.Y.Z` at the tag's commit with the job's `GITHUB_TOKEN`. It is idempotent: if the branch already points at the tag it succeeds, and if it points anywhere else it fails rather than moving it. The tag stays the source of truth for the build and the store upload. `release/v0.1.0` was created by hand for the release that predates this job.
- Consequences: One more branch per release. The branches are read-only by convention only: the repo is private on a free plan, so there are no rulesets to block pushes or deletions (0009). `docs/RELEASING.md` A.2 lists the `release/*` ruleset to add when that changes. Old releases are not patched on their branch; a fix ships as a new release from `main` (trunk-based, 0004).
