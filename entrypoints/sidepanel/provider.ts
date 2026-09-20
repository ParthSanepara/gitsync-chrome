import { GitHubProvider } from '@/src/providers/github';

/** One provider (and so one client, one write queue) for the whole panel. */
export const provider = new GitHubProvider();
