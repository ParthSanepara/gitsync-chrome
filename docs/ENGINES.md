# Engines

Written before the engines, as SPEC §10 asks. An engine executes a `SyncPlan` (SPEC §7). It never chooses
itself: the planner did. UI never imports an engine directly, only the runner.

```ts
interface Engine {
  execute(
    plan: SyncPlan,
    creds: Credentials,
    onProgress: (p: Progress) => void,
    signal: AbortSignal,
  ): Promise<Result<SyncResult, SyncError>>;
}
```

Common rules:

- Refuse to run a plan with blockers (`plan_blocked`).
- Re-read the target tip before writing. If it moved since planning, stop with `stale_plan`. Never overwrite work
  the user did not see in the preview.
- Every write goes through the client's serialized queue (SPEC §14 rule 5). Reads may run 4 at a time.
- Check the `AbortSignal` between steps. Objects already uploaded when cancelled are unreferenced and harmless.
- Failures are typed (`SyncError`). Nothing is thrown.

## tree-replay, snapshot mode

Goal: make the target branch's tree equal to the source commit's tree, in one new commit.

1. Read the source tree and the target tip's tree (recursive). Compute the diff with `diffTrees`, the same
   function the planner used, so the preview and the run cannot disagree.
2. For each blob that must be uploaded: read it from the source (base64), create it in the target. GitHub
   hashes content, so the returned SHA must equal the source SHA. A mismatch aborts (`blob_mismatch`).
   Blobs the target already holds under any path are skipped.
3. Create trees. Only changed entries are sent, on top of `base_tree` (the target tip's tree). Deleted paths
   are entries with `sha: null`. Chunks of `TREE_CHUNK` entries, each chained on the previous result.
4. Create one commit: tree = last tree, parent = target tip. A new branch (no tip) gets a parentless commit
   and no `base_tree`.
5. Existing branch: `PATCH git/refs/heads/{branch}` to the commit (`force` only if the plan says force
   push; a child of the tip is a fast-forward anyway). Missing branch: `POST git/refs`.

Empty target repository (git data endpoints answer 409): create the first file with the Contents API, which
creates the initial commit and default branch, then continue from step 1 against that commit.
VERIFY against a real empty repo before relying on it.

Submodules (mode 160000) are copied as gitlinks. Commit SHAs differ from the source.

## ref-copy

Full history across a fork network: point a target branch at a commit that only exists in the source.

1. Re-read the target branch. If it moved since planning, stop with `stale_plan`.
2. Probe again that the target can reach the source commit (`GET git/commits/{sha}` on the target: 200 means
   yes). If not, stop with `commit_unreachable`. The probe is the actual precondition, not the fork metadata.
3. Missing branch: `POST git/refs`. Existing branch: `PATCH git/refs/heads/{branch}` with `force` when the plan
   says so. Moving a branch onto unrelated history is not a fast-forward, so the planner requires force push
   (`needs_force`), except for a pull-request work branch, which is ours to move.

One write, no blobs, no new commit. VERIFY against a real fork before relying on it.

## Pull-request mode (either engine)

For protected branches, or when the change should be reviewed. The plan's `target.branch` is a work branch
`gitsync/<source ref>` and `pullRequest` is `{ base, head }`.

- The base branch must exist (`pr_base_missing` otherwise) and is never written.
- A missing work branch starts from the base, so the PR diff is only what differs.
- After the branch is updated, `POST pulls`. If one is already open for the branch (a second run), reuse it.
- If the branch updated but the PR failed, say so (`pr_failed`): the branch is already changed.

## Whole repository (`src/batch.ts`)

Not an engine: it runs the engines once per branch. Every source branch (default branch first, at most 100) is
planned against the same-named target branch. Running is sequential, and **each branch is planned again just
before it runs**: syncing `main` moves the tip that later new branches start from. A blocked branch is skipped
with its reason, a failed branch does not stop the others, and an expired login or rate limit stops the run.
Tags are not synced. Branches that exist only in the target are never deleted.

## Refused writes

GitHub's refusals are mapped to what the user can do about them (`src/engines/shared.ts`): a protected branch
points to pull-request mode, and secret scanning shows GitHub's explanation and says it cannot be bypassed. The
message patterns are VERIFY items.

## git-clone (not built yet, gated on M0)

isomorphic-git clone and push from an offscreen document. See SPEC §8.3.
