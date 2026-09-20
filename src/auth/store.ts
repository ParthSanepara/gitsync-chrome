import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { Credential, CredentialKey } from '@/src/providers/types';
import { GITHUB_HOST } from './config';

// Tokens live only in chrome.storage.session, so a browser restart signs the user out (SPEC §6.4).
// Never use chrome.storage.sync, and never log a Credential.
const STORAGE_KEY = 'credentials';

const credentialSchema = z.object({
  key: z.string().regex(/^.+:.+$/),
  kind: z.enum(['pat', 'oauth']),
  token: z.string(),
  scopes: z.array(z.string()),
  login: z.string(),
  expiresAt: z.number().optional(),
});
const storeSchema = z.record(z.string(), credentialSchema);

export const credentialKey = (owner: string): CredentialKey => `${GITHUB_HOST}:${owner}`;

export async function loadCredentials(): Promise<Record<string, Credential>> {
  const raw = (await browser.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  const parsed = storeSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Record<string, Credential>) : {};
}

export async function saveCredential(credential: Credential): Promise<void> {
  const all = await loadCredentials();
  await browser.storage.session.set({ [STORAGE_KEY]: { ...all, [credential.key]: credential } });
}

export async function clearCredentials(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEY);
}
