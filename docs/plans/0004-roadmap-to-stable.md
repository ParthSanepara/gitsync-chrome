# Plan 0004 — Roadmap to stable 1.0.0

- Date: 2026-09-17
- Status: v0.1.0 submitted to the Chrome Web Store, in review. Roadmap tracked as GitHub issues #6–#37.
- Note (2026-09-23): release-please was replaced by release branches with candidates (DECISIONS 0021).
  Where this plan says "release PR", read **Cut release** / **Finalize release**; `Release-As` becomes
  the version typed at cut.

## Context

v0.1.0 (placeholder side panel) was uploaded manually and submitted for review with Unlisted visibility.
Feature work (M0–M5 in SPEC §12) continues while the review runs. This plan covers what to do when the
review finishes, how feature work ships in the meantime, and how to reach a public 1.0.0.

## Tracking

Each SPEC §12 milestone is a GitHub milestone. Each checklist item is an issue with acceptance criteria and
"Depends on" links. `blocked` marks issues waiting on something outside the repo.

| Milestone              | Issues   | Gate                                                 |
| ---------------------- | -------- | ---------------------------------------------------- |
| M-1 Foundation release | #6, #7   | #6 waits for v0.1.0 approval                         |
| M0 Spike               | #8–#12   | #12 go/no-go review before any M1 work               |
| M1 Headless core       | #13–#21  | Sync drivable from the SW console                    |
| M2 UI                  | #22–#25  | Usable for real work                                 |
| M3 Polish              | #26–#31  | #30 depends on the M0 git-clone decision             |
| M4 Store readiness     | #32, #33 | Store build verified against dev                     |
| M5 Public 1.0          | #34–#37  | #37 releases 1.0.0 and switches visibility to Public |

## While v0.1.0 is in review

- Keep merging feature PRs to `main` (`feat:`/`fix:` titles). CI runs as usual.
- release-please keeps its release PR open and updates it. **Do not merge the release PR yet.** The store
  rejects an upload while an item has a pending review, so the `publish` job would fail.
- Work M0 first (#8–#12). It needs no store changes.

## When the review finishes

**Approved:**

1. The item goes live as Unlisted. If "publish automatically after review" was turned off at submit,
   click **Publish** in the dashboard.
2. Install it from the store listing link and confirm the side panel opens.
3. Do #6: service account, environment secrets, **Store dry run**, then the first automated release.
   From then on, never upload in the dashboard.

**Rejected:** read the email, fix the listing or code in a PR, and resubmit. Re-uploading needs a higher
version, so let the pipeline cut it (merge a `fix:` PR and the release PR) once #6's secrets are in place,
or upload the next release zip manually only if automation isn't set up yet.

## Shipping features before 1.0

- Pre-1.0 versions: `feat:` → `0.x+1.0`, `fix:` → `0.x.y+1`. Each merged release PR goes to review and
  then to the Unlisted listing.
- Release when a milestone lands (for example end of M2), not after every PR. That keeps review
  queues short. Only one version can be in review at a time.
- Any PR that adds a manifest permission also updates `docs/store/listing.md`, `PRIVACY.md` (and its
  published copy), and SPEC §11. New permissions often mean a longer review, and Chrome may disable the
  extension for existing users until they accept the new permissions.
- Before each release: load `.output/chrome-mv3` unpacked, run the manual checklist, update
  `docs/store/listing.md` so the listing never promises more than the version does.

## Going stable (#37)

1. M1–M4 closed and M5 features merged.
2. Merge a PR whose squash commit body has the footer `Release-As: 1.0.0`. release-please then proposes
   1.0.0 instead of the next 0.x.
3. Merge the release PR. The pipeline uploads and submits 1.0.0.
4. After approval: Dashboard → **Distribution → Visibility → Public**, then save and submit.
5. Link the store listing from the README.

After 1.0.0, `feat:` → minor and `fix:` → patch as usual. Breaking changes (`feat!:`) → 2.0.0.

## Risks

- Repo is now public, but DECISIONS 0009 says private. #7 resolves the doc drift and re-enables rulesets
  and GitHub Pages.
- Tokens live in session storage only, so scheduled sync (#35) cannot run after a browser restart without
  re-auth. Decide the UX before building it.
