# Plan 0005 — Release 0.2.0

- Date: 2026-09-23
- Status: preparing. Release PR #42 is open and green. Do not merge it until every gate below is checked.

## What ships

0.2.0 is the first version that actually syncs. v0.1.0 was a placeholder side panel.

- Sign in with GitHub (device flow), kept for up to 7 days.
- Source and target repository and branch pickers; the source is pre-filled from the open GitHub tab.
  Branch search covers every branch of large repos.
- Preview before anything is written: engine, estimated API calls, blockers, and warnings.
- Latest commit only (snapshot), or full history (ref-copy inside a fork network, git clone and push
  otherwise).
- Push, force push, or open a pull request. New target branches are created.
- Entire repository: every branch (up to 100) into same-named branches.

### Manifest change since v0.1.0

| v0.1.0         | 0.2.0                                            |
| -------------- | ------------------------------------------------ |
| `sidePanel`    | `sidePanel`, `storage`, `offscreen`, `activeTab` |
| no host access | `https://github.com/*`                           |

The host permission shows existing users a new warning ("Read and change your data on github.com"), and
Chrome disables the extension for them until they accept it. The item is Unlisted, so few users are
affected. New permissions usually mean a longer review.

## Gates (all must be true before merging #42)

1. **v0.1.0 review is finished.** The store rejects an upload while a review is pending (plan 0004).
   If v0.1.0 was rejected, 0.2.0 replaces it: fix what the rejection named, then continue.
2. **Store listing text is ready.** `docs/store/listing.md` has a 0.2.0 section that describes only what
   0.2.0 does.
3. **Privacy policy is published.** `PRIVACY.md` on `main` is current (#38). No Gist exists yet. The repo
   is public, so the policy URL can be `https://github.com/ParthSanepara/gitsync-chrome/blob/main/PRIVACY.md`
   (or GitHub Pages, #7). The store's privacy policy URL must point at it.
4. **Dashboard Privacy tab is updated by hand.** The store API does not edit it. Paste the single purpose
   and the five justifications from `listing.md`. Data usage: see the open question below.
5. **Screenshots show the real UI.** At least one 1280×800 of the setup screen and one of the preview.
6. **Manual test passes** on `pnpm zip` output from `main` (checklist below).
7. **Publishing path chosen.** The `chrome-web-store` environment has no secrets, so the `publish` job
   will skip with a notice. Either finish #6 (service account, secrets, Store dry run) first, or upload
   the release zip by hand one more time. Manual is allowed until automation is live.

## Manual test checklist

Load `.output/chrome-mv3` unpacked, in a fresh Chrome profile.

- [ ] Toolbar icon is the dark logo; clicking it opens the side panel.
- [ ] Sign in with GitHub: code shown, approval completes, account shown. Close and reopen Chrome: still
      signed in. Sign out works.
- [ ] Open a GitHub repo tab, then the panel: source is pre-filled.
- [ ] Repo with more than 500 branches: default branch selected with the "default" badge; typing finds a
      branch past the first 500.
- [ ] One branch, latest commit only, push, between two unrelated repos you own. Target branch updated.
- [ ] Full history into a fork (ref-copy): completes in seconds.
- [ ] Full history between unrelated repos (git clone): completes on a small repo.
- [ ] Open a pull request: PR link shown and opens.
- [ ] New target branch name: created.
- [ ] Entire repository on a repo with a few branches.
- [ ] Sync touching `.github/workflows/`: succeeds (login includes `workflow`).
- [ ] Cancel mid-sync: target branch untouched.

## Release steps

1. Merge the prep PR (this plan, listing text, doc fixes).
2. Check every gate above.
3. Merge #42. release-please tags `v0.2.0` and creates the GitHub release. Then, in `release.yml`:
   - `release-branch` creates `release/v0.2.0` at the tag (first real run of that job).
   - `build` attaches `gitsync-chrome-0.2.0-chrome.zip` to the release.
   - `publish` submits it, or skips with a notice (gate 7).
4. Verify: the release has the zip; `release/v0.2.0` points at the `v0.2.0` commit; the zip's
   `manifest.json` says `"version": "0.2.0"` with the permissions above.
5. If `publish` skipped: dashboard → Package → upload the zip from the release → Submit for review.
   Visibility stays **Unlisted**.
6. After approval: install from the listing, rerun the first four checklist items, close the issues the
   release covers.

A rejected or broken 0.2.0 cannot be rolled back in the store. Fix forward: merge a `fix:` PR and release
0.2.1.

## Open questions

- **Data usage answers.** 0.2.0 stores a GitHub token on the device and reads and writes repository
  contents, all between the browser and GitHub, never to the developer. Decide whether to declare
  "Authentication information" and "Website content" as handled data (safer for review) or keep "no data
  collected". Update the Privacy practices section of `listing.md` to match.
- **Rulesets.** The repo is public, so rulesets are available (DECISIONS 0020). Create them for `main` and
  `release/*` (`docs/RELEASING.md` A.2) before `release/v0.2.0` exists, so it is protected from the start.
