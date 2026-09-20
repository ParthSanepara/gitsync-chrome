# M0 spike

Throwaway. Validates SPEC §12 M0 before any real code is written. Delete when M1 starts.

## Build and load

```
cd spike
pnpm install
pnpm build
```

In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `spike/dist`.
Then open the extension's **Details → Extension options**. The options page is the control panel.
After rebuilding, click reload on the extension card.

Where results show up:
- The options page log. Use **Copy log** to share it.
- The offscreen console. On the extension card, click `offscreen.html` under "Inspect views".

## What you need

- For exp 0: an OAuth App with Device Flow enabled, and its `client_id`. Exp 0 saves the token like a PAT, so exps 2-5 can then run on it. Compare with a PAT if a push fails.
- A fine-grained PAT (optional if you use exp 0). For the target repo it needs Contents: read & write and Metadata: read. For exp 5 it also needs Contents: write on your fork.
  Set it under Credentials. It is kept in `chrome.storage.session` only.
- A fresh empty throwaway repo as the target, e.g. `you/gitsync-spike-target`.
- A small public repo to clone (exp 1/2) and a ~50 MB one (exp 3).
- For exp 5: a fork you own of some upstream whose branch has commits your fork does not have yet.

## Experiments

| # | Button | Pass condition |
|---|---|---|
| 0 | Log in with GitHub | Code request returns 200 from an extension context (no CORS block), polling ends with a token, `apiUser.status: 200`. Note whether `slowDownSeen` and the `grantedScope` |
| 1 | Clone only | `pass: true`, no CORS or network error |
| 2 | Clone + push (small repo) | `push.ok: true`. On auth failure, switch the onAuth form and retry |
| 3 | Clone + push (~50 MB repo) | Record `cloneSeconds`, `pushSeconds`, `metrics.peakJsHeapMB`, `metrics.storageUsageMB`. Also note the offscreen doc's memory in Chrome Task Manager (Shift+Esc) |
| 4 | Probe blob ceiling | Record the largest size that returns 201 and the error body at the first failure |
| 5 | Ref-copy | `probeFork.status: 200`, `probeControl.status: 404`, `pass: true`, `upstreamShaDiffersFromFork: true` |
| 6 | Run exp 3, then in `chrome://serviceworker-internals` click **Stop** for this extension | Progress keeps updating and the result still arrives. **Ping SW** shows the worker restarted |

Use a different target branch for each push run, or tick force push.
