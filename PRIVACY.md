# GitSync Privacy Policy

_Last updated: 2026-09-17_

GitSync is a Chrome extension with a single purpose: sync branches between GitHub repositories.

## Summary

- GitSync has no server, no account, and no analytics.
- GitSync does not collect, sell, or share your data.
- Anything GitSync stores stays in your browser.

## Data collection

GitSync does not collect, transmit, sell, or share any personal data or usage data. It has no analytics,
telemetry, crash reporting, advertising, or tracking. The developer never receives any data from the
extension.

## Data stored on your device

The current version stores no data.

Future versions that connect to GitHub will store:

- **Access tokens you provide**, in the browser's session storage (`chrome.storage.session`). Session
  storage is kept in memory and cleared when the browser closes. Tokens are never written to disk by
  GitSync, never synced to your Google account, and never logged.
- **Sync configurations you save** (for example, source and target repository names), in the browser's
  local storage (`chrome.storage.local`).

GitSync never uses `chrome.storage.sync`, so none of this data is copied to Google's servers.

## Data sent to third parties

GitSync talks only to GitHub (`api.github.com`, `github.com`), and only to perform an operation you
request. Your token and repository data go directly from your browser to GitHub, never through a
GitSync server or any other third party. GitHub's handling of that data is covered by the
[GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Permissions

- `sidePanel`: shows GitSync's interface in the Chrome side panel.

Any permission added in a future version will be listed here with its purpose before that version is
published.

## Limited Use

GitSync's use of information complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. Data is used only to provide the extension's single purpose. It
is not used for advertising, not sold, not transferred to third parties, and not used to determine
creditworthiness or for lending.

## Removing your data

Uninstalling GitSync deletes everything it stored. Closing the browser clears any stored tokens.

## Changes

Changes to this policy are published at this address, with an updated "Last updated" date.

## Contact

Contact the developer using the support email shown on GitSync's Chrome Web Store listing.
