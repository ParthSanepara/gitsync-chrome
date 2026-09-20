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
