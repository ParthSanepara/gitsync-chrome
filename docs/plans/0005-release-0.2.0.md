# Plan 0005 — Release 0.2.0

- Date: 2026-09-23
- Status: cutting `release/v0.2.0` and `v0.2.0-rc.1` for testing. First release through the flow in
  DECISIONS 0021. Do not run **Finalize release** until every gate below is checked.

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

## Gates (all must be true before Finalize)

1. **v0.1.0 review is finished.** The store rejects an upload while a review is pending (plan 0004).
   If v0.1.0 was rejected, 0.2.0 replaces it: fix what the rejection named, then continue.
2. **Store listing text is ready.** `docs/store/listing.md` has a 0.2.0 section that describes only what
   0.2.0 does.
3. **Privacy policy is published.** `PRIVACY.md` on `main` is current (#38). No Gist exists yet. The repo
   is public, so the policy URL can be `https://github.com/ParthSanepara/gitsync-chrome/blob/main/PRIVACY.md`
   (or GitHub Pages, #7). The store's privacy policy URL must point at it.
4. **Dashboard Privacy tab is updated by hand.** The store API does not edit it. Paste the single purpose
   and the five justifications from `listing.md`, and the data usage answers (Decided, below).
5. **Screenshots show the real UI.** At least one 1280×800 of the setup screen and one of the preview.
6. **Manual test passes** on the latest `v0.2.0-rc.N` pre-release zip (checklist below).
7. **Publishing path chosen.** The `chrome-web-store` environment has no secrets, so the `publish` job
   will skip with a notice. Either finish #6 (service account, secrets, Store dry run) first, or upload
   the release zip by hand one more time. Manual is allowed until automation is live.

## Manual test checklist

Unzip the candidate's `gitsync-chrome-0.2.0-chrome.zip` and load it unpacked, in a fresh Chrome profile.

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

1. Merge the prep PR (this plan, the new release workflows, listing text).
2. Close release-please's PR #42 unmerged; the new flow computes the same changelog.
3. **Cut release** `0.2.0`: creates `release/v0.2.0` from `main` with version 0.2.0 and the changelog,
   and publishes pre-release `v0.2.0-rc.1` with the zip.
4. Test the candidate with the checklist. For a failure: PR a fix into `release/v0.2.0`; that publishes
   `v0.2.0-rc.2`; test again.
5. When a candidate passes and every gate is checked: **Finalize release** `0.2.0`. It tags `v0.2.0` on
   the candidate, publishes the same zip, runs `publish` (skips while store secrets are missing),
   freezes `release/v0.2.0`, and opens the back-merge PR.
6. If `publish` skipped: dashboard → Package → upload the zip from the `v0.2.0` release → Submit for
   review. Visibility stays **Unlisted**.
7. Squash-merge `chore(release): merge v0.2.0 back into main`.
8. After approval: install from the listing, rerun the first four checklist items, close the issues the
   release covers.

A rejected or broken 0.2.0 cannot be rolled back in the store. Fix forward: merge a `fix:` PR and release
0.2.1.

## Decided

- **Data usage:** declare Authentication information and Website content (`docs/store/listing.md`).
- **Rulesets:** `main` is protected now. **Frozen releases** is created with `release/v0.1.0` in it;
  Finalize adds `release/v0.2.0`. Open release branches stay writable for hotfixes (DECISIONS 0021).
- **Release token:** `RELEASE_PLEASE_TOKEN` needs _Administration: write_ added before Finalize, or the
  `freeze` job fails (`docs/RELEASING.md` A.1).
