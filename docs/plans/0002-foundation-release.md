# Plan 0002 — Foundation release (minimal extension + CI/CD to Chrome Web Store)

- Date: 2026-09-17
- Status: steps 1–3 done (v0.1.0 released 2026-09-17). Steps 4–5 pending the manual store setup.
- Supersedes: the ordering in plan 0001 (M0 now follows this plan)

## Context

Before building any sync feature, the repo gets its permanent architecture, and the
path from merged PR to a Chrome Web Store release is proven with a minimal
extension. `spike/` (plan 0001) stays as-is for later use.

## Decisions

| Area             | Choice                                                                                      | Decision log |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------ |
| Framework        | WXT + React + TypeScript (strict) + Tailwind (SPEC §3)                                      | —            |
| Branching        | Trunk: protected `main`, short-lived branches, squash-merge PRs                             | 0004         |
| Versioning       | release-please from conventional commits, starting at `0.1.0`                               | 0005         |
| Publishing       | Release tag → CI builds zip → GitHub release asset → `wxt submit` (Chrome Web Store API v2) | 0006         |
| First visibility | Unlisted                                                                                    | 0007         |

## 1. Extension (standard MV3 components only)

- `entrypoints/background.ts`: service worker. Sets `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- `entrypoints/sidepanel/`: React placeholder with name, version, single-purpose sentence.
- Permissions: `sidePanel` only. No host permissions. They arrive with the features that need them.
- Icons 16/32/48/128 in `public/icon/`.
- Layout follows SPEC §10. `src/` subfolders are created when code needs them.
- `spike/` is excluded from root tsconfig, lint, and CI.

## 2. Tooling

- pnpm, Node pinned via `.nvmrc` + `packageManager`.
- Scripts: `dev`, `build`, `zip`, `typecheck`, `lint`, `format`, `test`.
- vitest with `WxtVitest` plugin and fake browser.

## 3. CI/CD (`.github/`)

- `workflows/ci.yml`: PR + push to main. Frozen install → lint → typecheck → test → build → zip. Uploads zip artifact. Fails if the production bundle contains the dev/HMR runtime.
- `workflows/pr-title.yml`: conventional-commit PR titles (squash merge makes the title the commit).
- `workflows/release.yml`: on push to main, release-please maintains a release PR (bumps `package.json`, which WXT uses as the manifest version, and `CHANGELOG.md`). When a release is created: build, zip, attach to the GitHub release, then `wxt submit` inside the `chrome-web-store` GitHub Environment. Submission is skipped while the store secrets are absent.
- `dependabot.yml`: npm + GitHub Actions, grouped.
- release-please must use a PAT/GitHub App token (`RELEASE_PLEASE_TOKEN`), because PRs opened with `GITHUB_TOKEN` do not trigger CI and could never pass branch protection.

## 4. One-time manual setup

See `docs/RELEASING.md`.

## 5. Execution order

1. Scaffold + tooling → CI green → load unpacked → side panel opens.
2. Workflows + `docs/RELEASING.md`.
3. Merge the release-please PR → `v0.1.0` tag → GitHub release with zip.
4. (Manual) Store setup, first submission reviewed.
5. Add secrets; next release (`v0.1.1`) proves automated upload + submit.
6. SPEC §12/§13, CLAUDE.md, DECISIONS.md updated alongside.

## Risks / verify during build

- Chrome Web Store API v1 reportedly deprecated 2026-10-15: target v2 from the start.
- `wxt submit` v2 support: confirmed in the CLI (`--chrome-api-version v2`, `CHROME_PUBLISHER_ID`, service-account env vars). The first run is the manual `store-dry-run.yml`.
- ~~OAuth refresh-token expiry~~ Resolved: `wxt submit` (publish-extension 6.1.1) uses a service account for API v2, so there is no refresh token (DECISIONS 0006).
- Store versions must strictly increase. Never upload manually outside the pipeline after v0.1.0.

## Progress log

- 2026-09-17: PR #1 merged (scaffold + CI/CD). PR #3 fixed a format check on the generated release manifest.
  Release PR #2 merged → `v0.1.0` tag, zip attached to the GitHub release, publish job skipped (no store secrets yet).
- Lessons:
  - `actions/upload-artifact` skips dot-directories unless `include-hidden-files: true` (`.output/`).
  - release-please needs Issues: write in addition to Contents and Pull requests.
  - release-please does not refresh its PR for commits that don't change the changelog (`ci:`, `chore:`).
    If such a commit fixes the release PR's CI, update the PR branch from `main` ("Update branch" button).
  - Repo kept private: no enforced rulesets and no GitHub Pages on the free plan (DECISIONS 0009).
