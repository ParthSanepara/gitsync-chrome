import { clearCredentials } from '@/src/auth/store';
import { GitHubClient } from '@/src/providers/github/client';
import { GitHubProvider } from '@/src/providers/github';

/** One provider (and so one client, one write queue) for the whole panel. A 401 ends the stored login. */
export const provider = new GitHubProvider(
  new GitHubClient(undefined, { onUnauthorized: () => void clearCredentials() }),
);
