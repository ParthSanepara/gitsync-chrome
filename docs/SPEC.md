# GitSync — Project Specification

> Working spec for `gitsync-chrome`. Commit as `docs/SPEC.md`.
> Keep `CLAUDE.md` short and have it say: "Read `docs/SPEC.md` before any
> architectural change. Do not deviate from it without updating it in the same PR."

---

## 1. What this is

A Chrome extension that copies a branch from one GitHub repository to another
repository the user has write access to.

**Single purpose statement** (use this exact wording in README, store listing,
and permission justifications):

> Sync branches between GitHub repositories.

The Chrome Web Store enforces a single-purpose policy. Any feature that does not
serve that sentence is out of scope. Notably out of scope: PR review UI, repo
browsing, issue management, code search, diff viewing beyond what the sync
preview requires.

### User-facing capability

| Dimension | Options |
|---|---|
| Source | any repo the user can read, at a branch / tag / commit SHA |
| Target | any repo the user can write, existing branch or new branch |
| History | latest commit only (squashed) · last N commits · full history |
| Write | direct push · force push · open a pull request instead |
| Branches | one branch · every branch of the repository |
| Scope | whole tree · path include/exclude globs · subdirectory remap |

The **user chooses the history mode**. The extension chooses the *engine* that
delivers it, and tells the user which one it picked and why.

---

## 2. Hard constraints

These are not preferences. Violating any of them breaks the product or the
store submission.

1. **No git binary.** Everything goes through the GitHub REST API or a
   JavaScript git implementation. There is no shell.
2. **No backend.** No proxy, no worker, no server of ours. All network calls go
   to `api.github.com` and `github.com` directly.
3. **No remotely hosted code.** Chrome Web Store policy: all logic ships in the
   package. No CDN imports, no runtime `eval` of fetched code, default CSP.
4. **Service worker is not durable.** MV3 terminates the extension service
   worker after roughly 30 seconds idle. Long work must not live there.
5. **Tokens never leave the browser.** No telemetry containing repo names,
   paths, or credentials. Ideally no telemetry at all in v1.

### Why no backend is possible

`api.github.com` sends CORS headers, so REST works from any extension context.
`github.com/*.git` (git smart HTTP) and `github.com/login/*` (device flow) do
**not** send CORS headers — this is why browser git libraries normally need a
proxy. An extension holding `https://github.com/*` in `host_permissions`
bypasses CORS for its own fetches, so the proxy is unnecessary. This is the
central architectural bet of the project and is validated by Milestone 0.

---

## 3. Stack

- **WXT** — extension framework. File-based entrypoints, generates the manifest,
  HMR, produces store zips, leaves the Firefox door open.
- **React + TypeScript**, strict mode on.
- **Tailwind** for the side panel UI.
- **isomorphic-git** + **@isomorphic-git/lightning-fs** — bundled, for the
  full-history engine.
- **zod** — validate every API response at the boundary. GitHub responses are
  large and partially optional; parse, don't trust.
- **vitest** — unit tests against recorded fixtures, no live network in CI.

No global state library. `chrome.storage` plus React context is enough.

---

## 4. Runtime architecture

```
┌─────────────────┐  messages  ┌──────────────────┐
│  side panel     │◄──────────►│  service worker  │
│  (React UI)     │            │  - dispatcher    │
└─────────────────┘            │  - rate governor │
                               │  - alarms        │
┌─────────────────┐            └────────┬─────────┘
│ content script  │───────────►         │ spawns
│ github.com/*    │                     ▼
│ injects Sync →  │            ┌──────────────────┐
└─────────────────┘            │ offscreen doc    │
                               │ - sync engines   │
                               │ - LightningFS    │
                               └──────────────────┘
```

**Service worker** — thin. Receives "start sync", creates the offscreen
document, relays progress messages, enforces the global rate-limit governor,
handles `chrome.alarms` for scheduled syncs. Never runs an engine.

**Offscreen document** — where all long-running work happens. Created with
`chrome.offscreen.createDocument({ reasons: ['WORKERS'], justification: ... })`.
Only one offscreen document can exist at a time; treat it as a singleton and
queue syncs rather than spawning a second.

**Side panel** — main UI. Chosen over a popup because a sync runs for minutes
and a popup closes on focus loss, destroying the progress view.

**Content script** — runs on `https://github.com/*`, injects a "Sync →" button
on repo, branch, and compare pages, parses owner/repo/ref from the URL, opens
the side panel prefilled. It performs no API calls and holds no credentials.

---

## 5. Provider abstraction

v1 ships GitHub only. GitLab is planned. The seam goes in now because retrofitting
it later is expensive and because it forces the planner to stop assuming
GitHub-specific behaviour.

```ts
type ProviderId = 'github' | 'gitlab';

interface Provider {
  id: ProviderId;
  host: string;              // api.github.com | gitlab.com | self-hosted host

  auth: {
    methods: AuthMethod[];   // github: ['device', 'pat']
    authorize(method: AuthMethod): Promise<Credential>;
    identity(cred: Credential): Promise<User>;
  };

  listRepos(cred: Credential, q: string): Promise<Repo[]>;
  getRepo(cred: Credential, repo: RepoRef): Promise<Repo>;   // any repo the account can read, not only its own
  listRefs(cred: Credential, repo: RepoRef): Promise<Ref[]>;
  resolveRef(cred: Credential, repo: RepoRef, ref: string): Promise<Commit>;
  getTree(cred: Credential, repo: RepoRef, sha: string): Promise<TreeEntry[]>;
  listCommits(cred: Credential, repo: RepoRef, ref: string, n: number): Promise<Commit[]>;

  /** Can a ref in `repo` point at this commit? True across a fork network. A probe, not an assumption. */
  canReachCommit(cred: Credential, repo: RepoRef, sha: string): Promise<boolean>;
  getBranch(cred: Credential, repo: RepoRef, branch: string): Promise<BranchState>;
  getTree(cred: Credential, repo: RepoRef, sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  readBlobText(cred: Credential, repo: RepoRef, sha: string): Promise<string>;
  rateLimit(): RateLimit | undefined;

  capabilities: {
    batchCommit: boolean;      // one call for many file actions (GitLab: true)
    objectStoreSharing: boolean; // fork network semantics (GitHub: true)
    lfs: boolean;
  };

  createBlob(...): Promise<string>;
  createTree(...): Promise<string>;
  createCommit(...): Promise<string>;
  createRef(...): Promise<void>;
  updateRef(...): Promise<void>;
  openPullRequest(...): Promise<{ url: string }>;

  cloneUrl(repo: RepoRef): string;
  authHeader(cred: Credential): Record<string, string>;
}
```

Three known GitLab divergences, encoded above so the planner never assumes:

- **No object-store sharing.** GitHub's fork network lets you create a ref
  pointing at a commit that exists only in the parent. GitLab has no equivalent,
  so the ref-copy engine is GitHub-only. Hence `canReachCommit()` is a probe,
  not an assumption.
- **Batch commits.** GitLab's commits API accepts an array of file actions
  (create/update/delete/move) in one call, replacing GitHub's
  blob→tree→commit→ref sequence. Tree-replay gets far cheaper there.
- **Self-hosted hosts** can't be declared at build time — they require
  `optional_host_permissions` and a runtime `chrome.permissions.request()`.

`planner.ts` must import `Provider`, never the GitHub client directly.

---

## 6. Authentication

### 6.1 Credential model — important

Fine-grained PATs are scoped to **a single owner**. Syncing `orgA/repo` →
`me/repo` therefore cannot be covered by one fine-grained token. GitLab
self-hosted makes this worse. So:

```ts
// WRONG — do not build this
interface Storage { token: string }

// RIGHT
type CredentialKey = `${string}:${string}`;   // `${host}:${owner}`

interface Credential {
  key: CredentialKey;
  kind: 'pat' | 'oauth';
  token: string;
  scopes: string[];
  login: string;
  expiresAt?: number;
}

interface CredentialStore {
  byKey: Record<CredentialKey, Credential>;
}
```

A `SyncPlan` resolves **two** credentials — read on source, write on target.
They may be different objects. Every provider method takes a `Credential`
explicitly; there is no ambient "current token".

### 6.2 PAT (ship in v1, keep forever)

User pastes a fine-grained PAT. Kept permanently as a first-class option, not a
stopgap: some users cannot authorize an OAuth app against a work org, and
fine-grained PATs scope more tightly than OAuth scopes.

Required permissions, surfaced in the UI as a checklist:

| Permission | Where | When |
|---|---|---|
| Metadata: read | both | always |
| Contents: read | source | always |
| Contents: read & write | target | always |
| Pull requests: write | target | PR mode only |
| Workflows: write | target | only if the sync touches `.github/workflows/**` |

Request Workflows conditionally. Asking for it up front deters users, and most
syncs never touch workflow files. Detect the need during planning and prompt
only then.

### 6.3 Device flow (v1.5)

Standard OAuth web flow is impossible — the code→token exchange needs a client
secret and there is nowhere safe to keep one in a shipped extension. Device flow
needs only a `client_id`, provided device flow is enabled in the app settings.

```
POST https://github.com/login/device/code
  { client_id, scope }
  → { device_code, user_code, verification_uri, expires_in, interval }

show user_code, open verification_uri

poll POST https://github.com/login/oauth/access_token
  { client_id, device_code, grant_type: urn:ietf:params:oauth:grant-type:device_code }
  → { access_token } | { error: authorization_pending | slow_down | expired_token | access_denied }
```

Honour `interval`, and increase it on `slow_down`. This endpoint has no CORS
headers, which is fine because of the `github.com` host permission.

Note: an **OAuth App** device flow yields classic scopes (`repo`, `workflow`) —
coarse. A **GitHub App** device flow yields the app's fine-grained permissions
but adds an installation step. Start with the OAuth App; revisit if users
complain about the breadth of `repo`.

### 6.4 Storage rules

- Tokens → `chrome.storage.local`, for at most 7 days from sign-in (DECISIONS 0014). This replaces the earlier
  session-only rule so a browser restart does not force a new login. Local storage is on disk and unencrypted, so
  a stored credential is dropped, and the user signs in again, when any of these happen:
  - it is older than 7 days, or its expiry is missing or implausibly far ahead, or the data does not parse
  - GitHub answers 401 to it (revoked or expired), on open or during any call
  - on open, GitHub reports a different account or different scopes than the ones stored
  - the extension updates (`runtime.onInstalled`, reason `update`)
  - the user signs out
  Removing or reinstalling the extension deletes its storage, so it also ends the login.
- Sync profiles, UI prefs → `chrome.storage.local`.
- **Nothing** in `chrome.storage.sync` — it replicates to Google's servers.
- Never log a token, not even truncated, not even in dev builds.
- Signing out only forgets the token here. Revoking it on GitHub (github.com/settings/applications) is up to the
  user, because revoking needs the OAuth App's client secret, which the extension does not have.

---

## 7. The plan/engine split

This is the most important design decision in the codebase.

`planner.ts` produces a `SyncPlan`. The preview screen renders it. An engine
executes it. Nothing downstream of the planner knows which engine ran. This is
what stops three engines becoming three codebases.

```ts
interface SyncPlan {
  source: { repo: RepoRef; ref: string; commit: Commit };
  target: { repo: RepoRef; branch: string; exists: boolean; currentSha?: string };

  mode: 'snapshot' | 'lastN' | 'full';
  n?: number;

  write: 'push' | 'force-push' | 'pull-request';
  filters?: { include?: string[]; exclude?: string[]; remap?: [from: string, to: string][] };

  engine: 'ref-copy' | 'tree-replay' | 'git-clone';
  engineReason: string;          // shown verbatim in the preview

  estimate: {
    filesChanged: number;
    blobsToUpload: number;       // after dedupe probe
    commits: number;
    apiCalls: number;
    bytes: number;
  };

  warnings: PlanWarning[];       // see error taxonomy
  blockers: PlanBlocker[];       // non-empty ⇒ Execute is disabled
}
```

Engine selection, in order — first match wins:

1. `mode === 'full'` **and** `provider.canReachCommit(tgt, srcSha)` → **ref-copy**
2. `mode === 'snapshot'` or (`mode === 'lastN'` and `n` small) → **tree-replay**
3. `mode === 'full'` → **git-clone**
4. repo too large for git-clone → **blocker**, with guidance

---

## 8. Engines

### 8.1 ref-copy — GitHub fork network

When source and target share an object store, a branch in the target can point
directly at a commit that physically lives in the source. Full history, one API
call, instant.

```
GET  /repos/{tgt}                      → .fork, .parent.full_name, .source.full_name
GET  /repos/{tgt}/git/commits/{srcSha} → 200 means the object is reachable
POST /repos/{tgt}/git/refs             { ref: "refs/heads/x", sha: srcSha }
  or
PATCH /repos/{tgt}/git/refs/heads/{x}  { sha: srcSha, force }
```

Detection: compare `source.full_name` / `parent.full_name` on both repos, then
confirm with the `GET git/commits/{sha}` probe against the target. Trust the
probe, not the metadata — the probe is the actual precondition.

### 8.2 tree-replay — REST, unrelated repos

Snapshot mode:

```
GET  /repos/{src}/git/trees/{sha}?recursive=1
for each blob:
  GET  /repos/{tgt}/git/blobs/{sha}     → 200 = already present, SKIP
  GET  /repos/{src}/git/blobs/{sha}     → base64 content
  POST /repos/{tgt}/git/blobs           → new sha
POST /repos/{tgt}/git/trees             (chunk with base_tree if large)
POST /repos/{tgt}/git/commits
POST|PATCH ref
```

The dedupe probe (`GET blobs/{sha}` on the target before uploading) is what makes
repeat syncs cheap. Blob SHAs are content-addressed, so an unchanged file is one
cheap GET instead of a download plus an upload. Implement it from day one.

`lastN` mode: walk commits oldest→newest, replay each with `base_tree` set to
the previous result. Only changed blobs upload per commit.

Constraints to enforce in the planner:
- Primary rate limit ~5000 req/hr authenticated. Compute `estimate.apiCalls` and
  block if it exceeds the remaining budget from the `X-RateLimit-Remaining` header.
- Secondary rate limits punish concurrent writes. **Serialize all POSTs**, with a
  small delay between them. Reads may run with limited concurrency (4 is safe).
- Large blobs fail. Set a guardrail and **verify the real ceiling empirically in
  M0** rather than trusting a number from memory. Detect oversize files during
  planning and emit a blocker.
- Very large trees must be chunked using `base_tree`.
- SHAs change unless author *and* committer, including dates, are replicated
  exactly. Any GPG-signed commit will always get a new SHA because the signature
  is not reproducible. Say so in the preview; do not promise SHA preservation.

### 8.3 git-clone — isomorphic-git, real git

```ts
await git.clone({ fs, http, dir, url, ref, singleBranch: true, onAuth });
await git.push({ fs, http, dir, remote: 'target', ref, force, onAuth });
```

`http` from `isomorphic-git/http/web`. `onAuth` returns `{ username: token }`.
`fs` is LightningFS backed by IndexedDB.

Preserves real history and real SHAs. Known risks, all to be settled in M0:

- **A shallow clone cannot be pushed as full history.** `depth` is off the table
  for `mode === 'full'`. Memory and time scale with repo size.
- **No LFS support.** Detect `.gitattributes` with `filter=lfs` during planning
  and emit a blocker. Pushing LFS pointers without the objects silently corrupts
  the target — this must never happen.
- IndexedDB quota. Estimate repo size via
  `GET /repos/{o}/{r}` `.size` (KB) and block above a threshold set in M0.
- Progress: wire `onProgress` through to the UI. A silent five-minute clone
  reads as a hang.

---

## 9. Error taxonomy

Every one of these needs a specific, actionable message. A generic "sync failed"
is a bug. Each maps to a `PlanWarning` (detected during planning) or a
`SyncError` (raised during execution).

| Condition | Detect | Message must say |
|---|---|---|
| Target repo empty | `GET git/ref` → 409 "Git Repository is empty" | needs the create-first path, not update-ref |
| Protected branch | push → 403/422 | offer to switch to PR mode |
| Missing `workflow` scope | push touching `.github/workflows/**` → 403 | which permission to add, and where |
| Secret scanning push protection | push → 409/422 with `GH013`-style body | which file and line, and that we cannot bypass |
| LFS repo | `.gitattributes` contains `filter=lfs` | refuse, explain why, do not partial-sync |
| Submodules | tree entry mode `160000` | they sync as gitlinks only; target must add the submodule itself |
| Oversize blob | size from tree listing | which file, and the limit |
| Rate limit exhausted | `X-RateLimit-Remaining` | when it resets, offer to resume |
| Archived / read-only target | `GET /repos/{tgt}` `.archived` | blocker |
| Token lacks write on target | `.permissions.push === false` | blocker, name the missing permission |
| Fork-network probe failed | `GET git/commits/{sha}` → 404 | fell back to a slower engine, say which |

---

## 10. Repo layout

```
gitsync-chrome/
├─ CLAUDE.md                  # short; points at docs/SPEC.md
├─ docs/
│  ├─ SPEC.md                 # this file
│  ├─ ENGINES.md              # written BEFORE engines are implemented
│  └─ DECISIONS.md            # append-only decision log
├─ entrypoints/
│  ├─ background.ts           # dispatcher, rate governor, alarms
│  ├─ sidepanel/
│  │  ├─ index.html
│  │  ├─ App.tsx
│  │  └─ screens/             # Auth, Source, Target, Preview, Progress, Result
│  ├─ offscreen/
│  │  ├─ index.html
│  │  └─ main.ts              # engine host
│  └─ github.content.ts
├─ src/
│  ├─ providers/
│  │  ├─ types.ts             # Provider, Credential, RepoRef, ...
│  │  └─ github/
│  │     ├─ client.ts         # fetch wrapper: auth, backoff, rate headers
│  │     ├─ schemas.ts        # zod
│  │     └─ index.ts          # implements Provider
│  ├─ engines/
│  │  ├─ types.ts             # Engine interface, progress events
│  │  ├─ refCopy.ts
│  │  ├─ treeReplay.ts
│  │  └─ gitClone.ts
│  ├─ planner.ts
│  ├─ profiles.ts
│  ├─ auth/
│  │  ├─ pat.ts
│  │  ├─ device.ts
│  │  └─ store.ts
│  ├─ messaging.ts            # typed channel, worker ↔ panel ↔ offscreen
│  └─ errors.ts               # the taxonomy above, as discriminated union
├─ tests/
│  ├─ fixtures/               # recorded GitHub responses
│  └─ *.test.ts
├─ PRIVACY.md                 # published via GitHub Pages
└─ wxt.config.ts
```

---

## 11. Manifest

```jsonc
{
  "permissions": ["storage", "sidePanel", "offscreen", "alarms"],
  "host_permissions": [
    "https://api.github.com/*",
    "https://github.com/*"
  ]
}
```

Consider moving `https://github.com/*` to `optional_host_permissions` and
requesting it at runtime. Broad host permissions at install time measurably hurt
install conversion and attract review scrutiny. The plumbing is also what
self-hosted GitLab will need later.

Permission justifications — write these now, not at submission:

- `https://github.com/*` — "Required to perform git clone and push operations
  over HTTPS directly from the user's browser, so that repository contents are
  never routed through any third-party server."
- `offscreen` — "Sync operations run for minutes; the extension service worker
  is terminated while idle and cannot host them."
- `storage` — "Stores the user's saved sync configurations locally and their
  access token in session storage."
- `alarms` — "Scheduled syncs."

---

## 12. Milestones

### M-1 — Foundation release (see `docs/plans/0002-foundation-release.md`)

Added 2026-09-17. Precedes M0.

- [ ] WXT + React + TS + Tailwind scaffold on the §10 layout, `sidePanel` permission only
- [ ] CI: format, lint, typecheck, test, build, zip, production-bundle check
- [ ] release-please → tag → zip on GitHub release → `wxt submit` (API v2)
- [ ] Unlisted store item live. A second release goes out fully automated

### M0 — Spike (do this first, alone)

No framework, no UI, no React. A bare unpacked extension with an offscreen
document. Answers the questions that can invalidate the design.

**Acceptance criteria**
- [ ] Clone a small repo from `https://github.com/...` with isomorphic-git, from
      an offscreen document, with **no CORS proxy**
- [ ] Push it to a fresh empty repo using a PAT
- [ ] Record the wall-clock time and peak memory for a ~50 MB repo
- [ ] Find the real blob-size ceiling on `POST git/blobs` empirically
- [ ] Confirm the fork-network ref-copy trick works end to end
- [ ] Confirm a full clone survives while the service worker is terminated

If the clone+push fails, git-clone is dropped and full history falls back to a
generated GitHub Actions workflow. **Do not start M1 before M0 passes.**

### M1 — Headless core
- [ ] GitHub client: auth header, exponential backoff, rate-limit header tracking
- [ ] zod schemas for every response consumed
- [ ] `Provider` implemented for GitHub
- [ ] ref-copy and tree-replay (snapshot) engines
- [ ] `planner.ts` with engine selection and estimates
- [ ] vitest suite against fixtures, no live network
- [ ] Drivable from the devtools console

### M2 — UI
- [ ] Side panel: Auth → Source → Target → Preview → Progress → Result
- [ ] PAT auth with the permission checklist
- [ ] Preview screen showing engine, reason, estimates, warnings, blockers
- [ ] Live progress with cancel
- [ ] Usable by you for real work

### M3 — Polish
- [ ] Saved sync profiles, one-click re-run
- [ ] Path filters and subdirectory remap
- [x] PR mode
- [~] Full error taxonomy with actionable messages (protected branch, secret scanning, branch-name conflicts, empty repo done; the rest as found)
- [ ] `lastN` and `full` modes wired to their engines
- [ ] Content script Sync button

### M4 — Store submission
- [ ] `PRIVACY.md` live on GitHub Pages
- [ ] Listing copy, icons, screenshots
- [ ] Permission justifications filled in
- [ ] **Publish unlisted first**, install from the store, verify the packaged
      build matches dev behaviour — they diverge more often than expected
- [ ] Confirm no WXT HMR runtime in the production zip

### M5 — Public
- [ ] Device flow auth
- [ ] Scheduled sync via alarms
- [ ] Optional host permissions at runtime

---

## 13. Repo hygiene

- `main` protected, trunk-based: short-lived branches, squash-merged PRs (DECISIONS 0004)
- release-please owns versions and changelog. Release tags drive store submission (0005, 0006)
- CI on PR: format + lint + typecheck + vitest + `wxt zip` + production-bundle check
- On release: `wxt zip`, attach to GitHub release, `wxt submit` (API v2). Runbook: `docs/RELEASING.md`
- Conventional commits (enforced on PR titles)
- `docs/DECISIONS.md` is append-only; every architectural change lands there in
  the same PR as the code

---

## 14. Rules for Claude Code

1. **Do not invent GitHub API endpoints, fields, or limits.** If unsure, add a
   `// VERIFY:` comment and a test against a recorded fixture rather than
   guessing. Several numbers in this spec are explicitly marked for empirical
   verification in M0.
2. **Never put long-running work in the service worker.** If a function might
   run over a few seconds, it belongs in the offscreen document.
3. **The planner owns engine selection.** Engines never choose themselves, and
   UI never imports an engine directly.
4. **`planner.ts` imports `Provider`, never the GitHub client.**
5. **Serialize writes.** Concurrent POSTs to the GitHub API trigger secondary
   rate limits that are far more punitive than the primary one.
6. **Every API response passes through a zod schema** before it reaches
   application code.
7. **No token in any log line**, including during development.
8. **No feature outside the single-purpose statement**, however small and
   however tempting.
9. **Failures are typed.** Add to the discriminated union in `src/errors.ts`;
   never throw a bare `Error` with a string.
10. **Tests use fixtures.** No live network in CI, ever.

---

## 15. Open questions

| # | Question | Resolved by | Status |
|---|---|---|---|
| 1 | Does isomorphic-git clone+push work with no proxy under host permissions? | M0 | open |
| 2 | Practical repo size ceiling for git-clone in an offscreen doc | M0 | open |
| 3 | Real `POST git/blobs` size limit | M0 | open |
| 4 | Install-time vs runtime host permission for `github.com` | M2 | open |
| 5 | OAuth App (`repo` scope) vs GitHub App (fine-grained) for device flow | M5 | open |
| 6 | Actions-delegated engine needed as fallback? | depends on Q1 | open |

Append answers to `docs/DECISIONS.md` as they close.
