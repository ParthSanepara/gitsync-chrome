/** Public OAuth App client ID. Device flow has no client secret (SPEC §6.3, DECISIONS 0010). */
export const GITHUB_CLIENT_ID = 'Ov23liJZ3Jj7qUPIlq3O';

/**
 * Requested once, at login, so a sync never needs a second approval (DECISIONS 0013). `workflow` is needed
 * to write anything under .github/workflows.
 */
export const GITHUB_SCOPE = 'repo workflow';

/** A login lasts a week, counted from sign-in, and ends sooner on any of the events in store.ts (DECISIONS 0014). */
export const CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const GITHUB_HOST = 'github.com';
