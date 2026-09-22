# Releasing

How a change reaches the Chrome Web Store, plus the one-time setup the pipeline depends on.
Design background: [plan 0002](plans/0002-foundation-release.md), decisions 0004–0008.

## Normal flow

Every release has its own branch, `release/vX.Y.Z`, and is tested as a candidate before it ships
(DECISIONS 0021). Only one release is open at a time.

1. **Develop on `main`.** Open PRs with a **conventional-commit title** (`feat: …`, `fix: …`,
   `chore: …`). CI (`ci.yml`) and the PR-title check (`pr-title.yml`) must pass. Squash-merge.
   The titles become the changelog: `feat:` → Features, `fix:` → Bug Fixes, `perf:` → Performance,
   `!` or a `BREAKING CHANGE:` footer → Breaking changes. Other types are left out. A squash commit
   body with a `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` block lists several entries instead.
2. **Cut.** Actions → **Cut release** → version `X.Y.Z`. Pick it by semver: breaking change → major,
   any `feat:` → minor, otherwise patch (before 1.0.0, breaking changes bump the minor). The workflow:
   - creates `release/vX.Y.Z` from `main`,
   - commits `chore(release): X.Y.Z` there: the `package.json` version and a new `CHANGELOG.md`
     section (`scripts/prepare-release.mjs`),
   - builds, tags **`vX.Y.Z-rc.1`**, and publishes it as a GitHub **pre-release** with the zip.
3. **Test the candidate.** Install the pre-release zip unpacked and run the release's checklist.
4. **Hotfix if needed.** Branch from `release/vX.Y.Z`, fix, open a PR **into `release/vX.Y.Z`**
   (`fix: …`), squash-merge. **Release candidate** runs on the merge and publishes `vX.Y.Z-rc.2`, and
   so on. Test again. Hotfix entries are not added to the changelog automatically; add a line to the
   version's `CHANGELOG.md` section in the same PR.
5. **Finalize.** Actions → **Finalize release** → version `X.Y.Z`. It refuses unless the branch head is
   a candidate, then:
   - tags **`vX.Y.Z`** on that same commit and publishes the candidate's zip, unchanged, as the release,
   - submits it to the Chrome Web Store (`publish`, environment `chrome-web-store`; skipped with a
     notice while the store secrets are missing, then upload the zip by hand),
   - **freezes** `release/vX.Y.Z` by adding it to the **Frozen releases** ruleset,
   - opens **`chore(release): merge vX.Y.Z back into main`** from a copy, `merge/vX.Y.Z`.
6. **Merge the back-merge PR** into `main` (squash). Do it before the next cut, so `main` has the
   version, changelog and hotfixes.
7. Google reviews the submission (hours to days). It goes live with the item's current visibility.

The manifest version comes from `package.json`, set only by **Cut release**. **Never edit the version
by hand, and never upload a zip in the dashboard after automation is live.** The store rejects any
version that is not strictly higher than the last upload.

A frozen release is never changed. A fix for a shipped version is a new release (`X.Y.Z+1`) cut from
`main`.

## One-time setup

### A. GitHub repository

1. **Release token.** A fine-grained PAT scoped to this repo, saved as repository secret
   `RELEASE_PLEASE_TOKEN` (the name predates DECISIONS 0021). Permissions, read & write:
   _Contents_, _Pull requests_, and _Administration_ (Finalize edits the Frozen releases ruleset).
   Why not `GITHUB_TOKEN`: PRs it opens do not trigger workflows, so the back-merge PR would never get
   CI checks, and it cannot manage rulesets.
2. **Rulesets** (Settings → Rules → Rulesets). The repo is public, so these are available
   (DECISIONS 0020, superseding 0009):
   - **`main`**: require a PR, require status checks `Lint, typecheck, test, build` and
     `Conventional commit title`, block force pushes and deletions, require linear history.
   - **Frozen releases**: restrict updates, block force pushes, restrict deletions. It lists each
     finalized `release/vX.Y.Z` by name; **Finalize release** adds them (and creates the ruleset the
     first time). Open release branches are not in it, so hotfix PRs can merge.

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

After B–D, run a whole release (Cut → test → Finalize). Confirm:

- the candidate and the final GitHub release both have the zip attached
- `release/vX.Y.Z` is listed in the Frozen releases ruleset, and the back-merge PR is open
- the `publish` job succeeded
- the dashboard shows the new version as pending review

## Troubleshooting

| Symptom                                  | Cause / fix                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Back-merge PR has no CI checks           | `RELEASE_PLEASE_TOKEN` missing or lacks permissions (A.1)                                                  |
| `freeze` fails with 403                  | the release token lacks _Administration: write_ (A.1)                                                      |
| Cut release: "still open (no final tag)" | another release branch is not finalized yet. Finalize it (or, if abandoned, delete that branch)            |
| Finalize: "head is not a candidate"      | a hotfix was merged after the last candidate. Wait for **Release candidate**, test that one, then finalize |
| `publish` skipped with notice            | environment secrets not set (C.4)                                                                          |
| Upload rejected: version must be greater | someone uploaded manually. Release a new version through the pipeline                                      |
| Upload rejected: item has pending review | a previous submission is still in review. Wait, or cancel it in the dashboard, then re-run the job         |
| 401/403 from store API                   | service account email not added in dashboard (C.3), or wrong publisher ID                                  |

## Rotating credentials

- Service account key: create a new JSON key → update `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` → run
  **Store dry run** → delete the old key in Cloud Console.
- `RELEASE_PLEASE_TOKEN`: fine-grained PATs expire. Set a calendar reminder and replace the secret before expiry.
