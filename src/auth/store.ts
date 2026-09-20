import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { Credential, CredentialKey } from '@/src/providers/types';
import { CREDENTIAL_TTL_MS, GITHUB_HOST } from './config';

// The token is kept in chrome.storage.local for CREDENTIAL_TTL_MS, so the user is not asked to sign in again
// every time the browser restarts (DECISIONS 0014, overriding the session-only rule in SPEC §6.4). The trade:
// local storage is on disk, unencrypted, readable by anything with access to the browser profile. Because of
// that, a stored credential is dropped, not trusted, when anything about it looks wrong:
//   - expired, or expiring implausibly far in the future (tampered)
//   - missing an expiry, or not matching the schema
//   - GitHub rejects the token, or it belongs to another account, or its scopes changed (see validate.ts)
//   - the extension updated (see lifecycle.ts)
// Never use chrome.storage.sync (it replicates to Google), and never log a Credential.
const STORAGE_KEY = 'credentials';
const CLOCK_SKEW_MS = 60_000;

const credentialSchema = z.object({
  key: z.string().regex(/^.+:.+$/),
  kind: z.enum(['pat', 'oauth']),
  token: z.string(),
  scopes: z.array(z.string()),
  login: z.string(),
  expiresAt: z.number(),
});
const storeSchema = z.record(z.string(), credentialSchema);

export const credentialKey = (owner: string): CredentialKey => `${GITHUB_HOST}:${owner}`;

function usable(c: Credential, now: number): boolean {
  return c.expiresAt !== undefined && c.expiresAt > now && c.expiresAt <= now + CREDENTIAL_TTL_MS + CLOCK_SKEW_MS;
}

export async function loadCredentials(now: number = Date.now()): Promise<Record<string, Credential>> {
  const raw = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (raw === undefined) return {};

  const parsed = storeSchema.safeParse(raw);
  if (!parsed.success) {
    await clearCredentials(); // malformed: do not guess
    return {};
  }
  const all = parsed.data as Record<string, Credential>;
  const kept = Object.fromEntries(Object.entries(all).filter(([, c]) => usable(c, now)));
  if (Object.keys(kept).length !== Object.keys(all).length) {
    if (Object.keys(kept).length === 0) await clearCredentials();
    else await browser.storage.local.set({ [STORAGE_KEY]: kept });
  }
  return kept;
}

export async function saveCredential(credential: Credential): Promise<void> {
  const all = await loadCredentials();
  await browser.storage.local.set({ [STORAGE_KEY]: { ...all, [credential.key]: credential } });
}

export async function clearCredentials(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
  // Earlier builds kept the token in session storage.
  await browser.storage.session.remove(STORAGE_KEY);
}
