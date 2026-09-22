/** Why a branch name is not acceptable to git, or undefined if it is fine. Mirrors `git check-ref-format`. */
export function branchNameProblem(name: string): string | undefined {
  if (!name) return 'Enter a branch name.';
  if (/\s/.test(name)) return 'Branch names cannot contain spaces.';
  if (/[\p{Cc}~^:?*[\\]/u.test(name)) return 'Branch names cannot contain ~ ^ : ? * [ or \\.';
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//'))
    return 'Branch names cannot start or end with "/" or contain "//".';
  if (name.includes('..') || name.includes('@{')) return 'Branch names cannot contain ".." or "@{".';
  if (name === '@' || name.startsWith('-')) return 'That is not a valid branch name.';
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    return 'Parts of a branch name cannot start with "." or end with ".lock".';
  }
  if (name.endsWith('.')) return 'Branch names cannot end with ".".';
  return undefined;
}

/** The branch a pull-request sync pushes to. Namespaced so it never collides with the user's own branches. */
export const prBranchName = (sourceRef: string) => `gitsync/${sourceRef}`;

/**
 * Git stores branches as files, so `feature` and `feature/x` cannot both exist. Returns the existing branch
 * that blocks `name`, if any.
 */
export function branchNameConflict(name: string, existing: string[]): string | undefined {
  return existing.find((e) => e !== name && (e.startsWith(`${name}/`) || name.startsWith(`${e}/`)));
}
