# Plan 0003 — GitHub login and branch sync

- Date: 2026-09-20
- Status: docs done (this PR). M0 spike changes and everything after pending.
- Follows: plan 0002 (foundation release, store approved)

## Goal

Connect with a GitHub login, get read/write access from the account, and sync a branch from one repo to another. Latest commit only, last N, or full history. Decisions: DECISIONS 0010.

## Steps

| Step | What                                                                                                                         | Depends on                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 0    | Register a GitHub OAuth App (github.com/settings/developers), tick "Enable Device Flow", commit the `client_id`              | User                                  |
| 1    | Finish plan 0002 step 5: store secrets, dry run, `v0.1.1` through the pipeline                                               | User adds secrets                     |
| 2    | Cut-down M0 spike: device flow from an extension context, no-proxy clone+push, blob ceiling, fork ref-copy, SW-kill survival | Step 0, throwaway target repo, a fork |
| 3    | M1 core: `auth/device.ts`, GitHub client, `Provider`, ref-copy and snapshot tree-replay engines, planner (plan 0001 Phase C) | Step 2 results                        |
| 4    | UI: Login → source repo + branch → target repo + branch → Preview → Progress → Result                                        | Step 3                                |
| 5    | Last N, full history (git-clone gated on M0), PR mode, path filters, profiles, content-script Sync button                    | Step 4                                |

## History mode → engine

- Latest commit only: tree-replay, snapshot.
- Last N: tree-replay, replayed oldest to newest.
- Full history: ref-copy when the repos share a fork network, else git-clone (M0 decides).

## Release impact

The first release with device flow adds `https://github.com/*` to `host_permissions`. Update the justification in `docs/RELEASING.md` and SPEC §11 in that PR. Existing installs will see a new-permission prompt.
