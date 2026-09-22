import { describe, expect, it } from 'vitest';
import { parseGitHubRepoUrl } from '@/src/providers/github/repoUrl';

describe('parseGitHubRepoUrl', () => {
  it('reads owner/repo off the root repo page', () => {
    expect(parseGitHubRepoUrl('https://github.com/facebook/react')).toEqual({ owner: 'facebook', name: 'react' });
  });

  it('reads owner/repo off a deep page (tree, blob, pull, actions, ...)', () => {
    expect(parseGitHubRepoUrl('https://github.com/facebook/react/tree/main/packages')).toEqual({
      owner: 'facebook',
      name: 'react',
    });
    expect(parseGitHubRepoUrl('https://github.com/facebook/react/pull/123/files')).toEqual({
      owner: 'facebook',
      name: 'react',
    });
  });

  it('strips a trailing .git', () => {
    expect(parseGitHubRepoUrl('https://github.com/facebook/react.git')).toEqual({ owner: 'facebook', name: 'react' });
  });

  it('ignores query strings and hashes', () => {
    expect(parseGitHubRepoUrl('https://github.com/facebook/react?tab=readme-ov-file#readme')).toEqual({
      owner: 'facebook',
      name: 'react',
    });
  });

  it('rejects a profile page (only one path segment)', () => {
    expect(parseGitHubRepoUrl('https://github.com/facebook')).toBeUndefined();
  });

  it('rejects the homepage', () => {
    expect(parseGitHubRepoUrl('https://github.com/')).toBeUndefined();
    expect(parseGitHubRepoUrl('https://github.com')).toBeUndefined();
  });

  it('rejects GitHub routes that look like owner/repo but are not', () => {
    expect(parseGitHubRepoUrl('https://github.com/settings/profile')).toBeUndefined();
    expect(parseGitHubRepoUrl('https://github.com/notifications/all')).toBeUndefined();
  });

  it('rejects a non-GitHub host, and a malformed URL', () => {
    expect(parseGitHubRepoUrl('https://gitlab.com/facebook/react')).toBeUndefined();
    expect(parseGitHubRepoUrl('not a url')).toBeUndefined();
  });
});
