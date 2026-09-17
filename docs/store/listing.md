# Chrome Web Store listing

Source of truth for the store listing text. Update it in the same PR as any change to the extension's
functionality, so the listing never promises more than the published version does.

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

**Are you using remote code?** No, I am not using remote code. (All JavaScript is bundled in the
package. No external scripts, no `eval`, no remotely fetched code.)

**Data usage:** tick no data types. Tick all three certifications.

**Privacy policy URL:** the public Gist of `PRIVACY.md` (`docs/RELEASING.md` §D).

## Notes

- Chrome Web Store policy rejects listings that describe functionality the extension doesn't have. Keep
  "PLANNED" items clearly separated from current features, and move them up as they ship.
