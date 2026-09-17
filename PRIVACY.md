# GitSync Privacy Policy

_Last updated: 2026-09-23_

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

- **Your GitHub sign-in token**, in the extension's local storage (`chrome.storage.local`), for at most
  7 days. It is removed earlier when you sign out, when GitHub rejects it, or when GitSync updates.
  Local storage is on your device's disk and is not encrypted by GitSync, so anyone with access to your
  browser profile could read it. GitSync never logs the token.
- **A temporary copy of repository files** during a full-history sync, in the extension's IndexedDB
  storage. GitSync clears it at the start of the next such sync.

GitSync never uses `chrome.storage.sync`, so none of this data is copied to Google's servers.

## Data sent to third parties

GitSync talks only to GitHub (`api.github.com`, `github.com`), and only to perform an operation you
request. Your token and repository data go directly from your browser to GitHub, never through a
GitSync server or any other third party. GitHub's handling of that data is covered by the
[GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Permissions

- `sidePanel`: shows GitSync's interface in the Chrome side panel.
- `storage`: keeps your GitHub sign-in token on your device, as described above.
- `offscreen`: runs long syncs in a background page, because the extension's service worker cannot.
- `activeTab`: when you open GitSync, reads the address of the tab you are on, so it can pre-select that
  GitHub repository as the sync source. Only that tab, only at that moment.
- Access to `https://github.com/*`: signs you in with GitHub, and clones and pushes repositories directly
  between your browser and GitHub.

Any permission added in a future version will be listed here with its purpose before that version is
published.

## Limited Use

GitSync's use of information complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. Data is used only to provide the extension's single purpose. It
is not used for advertising, not sold, not transferred to third parties, and not used to determine
creditworthiness or for lending.

## Removing your data

Uninstalling GitSync deletes everything it stored. Signing out removes the stored token. To also revoke
GitSync's access on GitHub's side, go to github.com/settings/applications.

## Changes

Changes to this policy are published at this address, with an updated "Last updated" date.

## Contact

Contact the developer using the support email shown on GitSync's Chrome Web Store listing.
