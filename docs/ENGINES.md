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

## ref-copy (not built yet)

`POST` or `PATCH` a ref in the target to a commit that only exists in the source, valid across a fork network.
One call. Needs a real fork to verify.

## git-clone (not built yet, gated on M0)

isomorphic-git clone and push from an offscreen document. See SPEC §8.3.
