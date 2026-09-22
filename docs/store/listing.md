# Chrome Web Store listing

Source of truth for the store listing text. Update it in the same PR as any change to the extension's
functionality, so the listing never promises more than the published version does.

## 0.2.0

**Summary:** unchanged.

**Description:**

```text
Sync branches between GitHub repositories.

Copy a branch from one GitHub repository to another repository you can write to, straight from a Chrome side panel. There is no GitSync server: your browser talks only to GitHub.

HOW IT WORKS
• Sign in with GitHub. GitSync shows a code; you approve it on github.com.
• Pick the source repository and branch, then the target repository and branch. If you open GitSync on a GitHub repository page, that repository is pre-selected as the source.
• See a preview of what will happen before anything is written.
• Run the sync and watch its progress. You can cancel; the target branch is only moved at the end.

OPTIONS
• Latest commit only: one new commit with the source files. Works between any two repositories.
• Full history: every commit. Instant when the target is a fork of the source; otherwise GitSync clones and pushes from your browser.
• Push to the target branch, force push, or open a pull request instead.
• Create a new target branch.
• Entire repository: sync every branch (up to 100) into same-named branches.

PRIVACY
• No GitSync account and no GitSync server. No analytics or tracking.
• Your GitHub sign-in is kept on your device for up to 7 days, and sent only to GitHub.
```

## v0.1.0 (early preview)

**Name:** GitSync

**Summary** (manifest `description`, max 132 chars):

> Sync branches between GitHub repositories.

**Category:** Developer Tools

**Description:**

```text
Sync branches between GitHub repositories.

GitSync is an early preview. This version installs the GitSync side panel. Branch syncing is not available yet and is coming in upcoming releases.

WHAT'S IN THIS VERSION
• Click the GitSync toolbar icon to open the side panel.

PLANNED
• Copy a branch, tag, or commit from one GitHub repository to another repository you can write to.
• Choose how much history to bring: the latest snapshot, the last few commits, or the full history.
• Push directly, or open a pull request instead.
• See a preview of what will change before anything is written.

PRIVACY
• No account and no GitSync server. Everything runs in your browser.
• No analytics, tracking, or data collection.
• This version requests only the side panel permission.
```

## Privacy practices tab

**Single purpose description:**

```text
GitSync syncs branches between GitHub repositories. The user picks a source branch in one GitHub repository and a target repository they can write to, and GitSync copies the branch there, either by pushing directly or by opening a pull request. Everything runs locally in the browser with no GitSync server. The extension has no other features.

This early preview version (0.1.0) installs the side panel that will host the sync interface. Branch syncing arrives in upcoming releases.
```

**Permission justifications** (keep in sync with `wxt.config.ts` and SPEC §11):

`sidePanel`:

```text
GitSync's entire user interface is a Chrome side panel, opened by clicking the toolbar icon. A branch sync can take minutes, and a side panel stays visible alongside the GitHub page the user is working on, instead of closing on the first click elsewhere like a popup does. The extension uses no other UI surface.
```

`storage`:

```text
Keeps the user's GitHub sign-in token in the extension's local storage for at most 7 days, so they do not have to sign in again after every browser restart. The token is removed earlier on sign out, when GitHub rejects it, or when the extension updates. It is never synced to the user's Google account.
```

`https://github.com/*` (host permission):

```text
Required to sign in with GitHub, and to perform git clone and push operations over HTTPS directly from the user's browser for full-history syncs, so that repository contents are never routed through any third-party server. GitHub's device-flow login endpoints (github.com/login/*) also do not allow cross-origin requests, so the extension needs host access to call them directly.
```

`offscreen`:

```text
Sync operations run for minutes; the extension service worker is terminated while idle and cannot host them.
```

`activeTab`:

```text
When the user opens the side panel, lets it read the URL of the tab they had open, so it can pre-select that repository as the sync source if it is a GitHub repo page. Granted only for that one tab, only at that moment.
```

**Are you using remote code?** No, I am not using remote code. (All JavaScript is bundled in the
package. No external scripts, no `eval`, no remotely fetched code.)

**Data usage:** tick no data types. Tick all three certifications.

**Privacy policy URL:** the public Gist of `PRIVACY.md` (`docs/RELEASING.md` §D).

## Notes

- Chrome Web Store policy rejects listings that describe functionality the extension doesn't have. Keep
  "PLANNED" items clearly separated from current features, and move them up as they ship.
