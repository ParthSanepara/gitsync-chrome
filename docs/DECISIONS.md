# Decisions

Append-only. Never edit or delete a past entry. To reverse a decision, add a new entry that supersedes it.

Entry format:

```
## NNNN — Title
- Date: YYYY-MM-DD
- Status: accepted | superseded by NNNN
- Context: why this came up
- Decision: what we chose
- Consequences: what follows from it
```

---

## 0001 — Use pnpm
- Date: 2026-09-17
- Status: accepted
- Context: Need one package manager for the project and CI.
- Decision: pnpm (via corepack).
- Consequences: Commit `pnpm-lock.yaml`. CI uses `pnpm install --frozen-lockfile`.

## 0002 — M0 is a framework-free spike in `spike/`
- Date: 2026-09-17
- Status: accepted
- Context: SPEC §12 requires validating the no-proxy git-over-HTTP bet before building anything.
- Decision: A bare MV3 extension in `spike/` with no WXT or React. esbuild is used only to bundle isomorphic-git into the offscreen document.
- Consequences: `spike/` is throwaway. It gets removed when M1 starts, and its measured results are recorded here.

## 0003 — Offscreen documents receive credentials by message
- Date: 2026-09-17
- Status: accepted
- Context: Offscreen documents only have access to `chrome.runtime`, not `chrome.storage`. Tokens live in `chrome.storage.session` (SPEC §6.4), so the engine host cannot read them directly.
- Decision: The service worker reads the needed credentials and includes them in the message that starts a sync. The offscreen document keeps them in memory for that sync only.
- Consequences: `src/messaging.ts` start-sync messages carry the source and target `Credential`s. Any offscreen logging must redact them. The spike already does this.
