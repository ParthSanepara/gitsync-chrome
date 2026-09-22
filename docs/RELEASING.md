# Releasing

How a change reaches the Chrome Web Store, plus the one-time setup the pipeline depends on.
Design background: [plan 0002](plans/0002-foundation-release.md), decisions 0004–0008.

## Normal flow (automated)

1. Open a PR against `main` with a **conventional-commit title** (`feat: …`, `fix: …`, `chore: …`).
   CI (`ci.yml`) and the PR-title check (`pr-title.yml`) must pass. Squash-merge.
2. `release.yml` runs on every push to `main`. release-please opens or updates a
   **release PR** that bumps `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
   - `feat:` → minor, `fix:` → patch, `feat!:` / `BREAKING CHANGE:` → major.
   - `docs:`, `chore:`, `ci:`, `test:`, `refactor:` do not trigger a release by themselves.
3. Merge the release PR. release-please tags `vX.Y.Z` and creates a GitHub release.
4. The `build` job builds the zip from the tag and attaches it to the GitHub release.
5. The `publish` job (GitHub Environment `chrome-web-store`) runs
   `wxt submit` with Chrome Web Store API v2. This uploads the zip and submits it for review.
   It is skipped, with a notice, while the store secrets are missing.
6. Google reviews it (hours to days). It goes live with the item's current visibility (Unlisted).

The manifest version comes from `package.json`. **Never edit the version by hand, and never upload
a zip in the dashboard after automation is live.** The store rejects any version that is not
strictly higher than the last upload, and a manual upload breaks the pipeline.

## One-time setup

### A. GitHub repository

1. **Release token.** Create a fine-grained PAT (or GitHub App token) scoped to this repo with
   _Contents_, _Issues_ (for release labels), and _Pull requests_ all set to read & write. Save it as repository secret
   `RELEASE_PLEASE_TOKEN`.
   Why not `GITHUB_TOKEN`: PRs it opens do not trigger workflows, so the release PR would never get CI
   checks and could not satisfy branch protection.
2. **Ruleset on `main`** (Settings → Rules → Rulesets). **Not available while the repo is private on
   a free plan** (DECISIONS 0009). Until then these are conventions, not enforced:
   - Merge through a PR only after CI and the PR-title check pass
   - No force pushes to `main`

   When the repo goes public or the plan is upgraded, turn them into a ruleset: require a PR, require status
   checks `Lint, typecheck, test, build` and `Conventional commit title`, block force pushes and deletions,
   require linear history.

3. **Merge settings** (Settings → General): allow squash merging only. Default squash message: _Pull request title_.
   Enable "Automatically delete head branches".
4. **Environment** `chrome-web-store` (Settings → Environments). Optionally add yourself as a required
   reviewer to approve every store submission. Restrict deployment to tags/`main`.

### B. Chrome Web Store: first upload (manual, once)

1. Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time fee,
   2-step verification required).
2. Download `gitsync-chrome-0.1.0-chrome.zip` from the `v0.1.0` GitHub release.
   Dashboard → **New item** → upload it. This creates the item and its **extension ID**. The API cannot
   create items.
3. **Store listing**
   - Description: open with the single-purpose statement _"Sync branches between GitHub repositories."_
   - Icon: `assets/icon.svg` rendered at 128px (`public/icon/128.png`)
   - At least one screenshot, 1280×800 or 640×400
   - Category: Developer Tools
4. **Privacy tab**
   - Single purpose, justifications, remote code: copy from `docs/store/listing.md` (Privacy practices tab).
   - Data usage: no user data collected. Tick the three certification boxes.
   - Privacy policy URL: public Gist URL of `PRIVACY.md` (see D).
5. **Distribution**: visibility **Unlisted**.
6. Submit for review.
7. Copy the **Publisher ID** (Dashboard → Settings / Account) and the **extension ID**.

### C. Chrome Web Store API credentials (service account, API v2)

`wxt submit` with API v2 authenticates with a service account. The OAuth client-ID/refresh-token options
are v1.1-only and deprecated.

1. Google Cloud Console → create/select a project → enable **Chrome Web Store API**.
2. IAM → Service accounts → create one (no roles needed) → Keys → **Add key → JSON**.
3. Developer Dashboard → **Account** → add the service account's email. Only one service account per publisher.
4. Add to the `chrome-web-store` environment secrets:

   | Secret                                | Value                                                      |
   | ------------------------------------- | ---------------------------------------------------------- |
   | `CHROME_EXTENSION_ID`                 | from B.7                                                   |
   | `CHROME_PUBLISHER_ID`                 | from B.7                                                   |
   | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | `client_email` from the JSON key                           |
   | `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`  | `private_key` from the JSON key, including BEGIN/END lines |

5. Delete the local JSON key file.
6. Actions → **Store dry run** → Run workflow. It checks authentication without uploading.

### D. Privacy policy page

The store asks for a privacy policy URL, and it must be publicly reachable. While the repo is private
(DECISIONS 0009), GitHub Pages is not an option on the free plan. Publish the contents of `PRIVACY.md`
as a **public GitHub Gist** (https://gist.github.com, "Create public gist") and use the gist URL in B.4.
When `PRIVACY.md` changes, update the gist in the same PR.

## Verifying the pipeline end to end

After B–D, merge any `fix:` PR, then merge the resulting release PR (`v0.1.1`). Confirm:

- the GitHub release has the zip attached
- the `publish` job succeeded
- the dashboard shows the new version as pending review

## Troubleshooting

| Symptom                                          | Cause / fix                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Release PR has no CI checks                      | `RELEASE_PLEASE_TOKEN` missing or lacks permissions (A.1)                                                  |
| Release PR CI fails after a fix landed on `main` | release-please only refreshes its PR when the changelog changes. Click **Update branch** on the release PR |
| `publish` skipped with notice                    | environment secrets not set (C.4)                                                                          |
| Upload rejected: version must be greater         | someone uploaded manually. Release a new version through the pipeline                                      |
| Upload rejected: item has pending review         | a previous submission is still in review. Wait, or cancel it in the dashboard, then re-run the job         |
| 401/403 from store API                           | service account email not added in dashboard (C.3), or wrong publisher ID                                  |

## Rotating credentials

- Service account key: create a new JSON key → update `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` → run
  **Store dry run** → delete the old key in Cloud Console.
- `RELEASE_PLEASE_TOKEN`: fine-grained PATs expire. Set a calendar reminder and replace the secret before expiry.
