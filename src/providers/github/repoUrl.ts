/**
 * Path segments that are GitHub routes, not usernames/orgs — `github.com/settings/...` is not a repo
 * "settings/...". Best-effort: GitHub does not publish this list, so an unmatched tab just skips the
 * pre-fill (SPEC §14 rule 8: this is a convenience, not a feature that needs to be exhaustive).
 */
const RESERVED_OWNERS = new Set([
  'settings',
  'notifications',
  'marketplace',
  'sponsors',
  'orgs',
  'organizations',
  'apps',
  'codespaces',
  'issues',
  'pulls',
  'pull',
  'dashboard',
  'explore',
  'topics',
  'trending',
  'collections',
  'events',
  'features',
  'about',
  'pricing',
  'contact',
  'security',
  'login',
  'logout',
  'join',
  'new',
  'search',
  'account',
  'enterprise',
  'team',
  'teams',
  'gist',
  'gists',
  'stars',
  'watching',
  'site',
  'support',
  'customer-stories',
  'readme',
  'resources',
  'solutions',
]);

/** Extracts `{owner, name}` from a github.com repo page URL (any path under it), or undefined if it is not one. */
export function parseGitHubRepoUrl(url: string): { owner: string; name: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return undefined;

  const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return undefined;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return undefined;

  return { owner, name: repo.replace(/\.git$/, '') };
}
