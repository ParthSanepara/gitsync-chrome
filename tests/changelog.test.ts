import { describe, expect, it } from 'vitest';
import { latestFinalTag, prependSection, renderSection, sectionFor } from '@/scripts/changelog.ts';

const repo = 'octo/gitsync';
const c = (sha: string, subject: string, body = '') => ({ sha, subject, body });

describe('renderSection', () => {
  it('groups features and fixes, and skips other types', () => {
    const out = renderSection({
      version: '0.2.0',
      previousTag: 'v0.1.0',
      date: '2026-09-23',
      repo,
      commits: [
        c('a'.repeat(40), 'feat: sync branches (#41)'),
        c('b'.repeat(40), 'fix(ui): pick the default branch'),
        c('c'.repeat(40), 'docs: release plan'),
        c('d'.repeat(40), 'chore(deps): bump vitest'),
      ],
    });
    expect(out).toBe(
      [
        '## [0.2.0](https://github.com/octo/gitsync/compare/v0.1.0...v0.2.0) (2026-09-23)',
        '',
        '### Features',
        '',
        `- sync branches (#41) ([aaaaaaa](https://github.com/octo/gitsync/commit/${'a'.repeat(40)}))`,
        '',
        '### Bug Fixes',
        '',
        `- pick the default branch ([bbbbbbb](https://github.com/octo/gitsync/commit/${'b'.repeat(40)}))`,
        '',
      ].join('\n'),
    );
  });

  it('uses a BEGIN_COMMIT_OVERRIDE block instead of the subject', () => {
    const body = 'BEGIN_COMMIT_OVERRIDE\nfeat: one\nfix: two\ndocs: three\nEND_COMMIT_OVERRIDE\n\nCo-Authored-By: x';
    const out = renderSection({
      version: '0.2.0',
      previousTag: 'v0.1.0',
      date: 'd',
      repo,
      commits: [c('e'.repeat(40), 'feat: everything (#41)', body)],
    });
    expect(out).toContain('- one (');
    expect(out).toContain('- two (');
    expect(out).not.toContain('everything');
    expect(out).not.toContain('three');
  });

  it('lists breaking changes on their own', () => {
    const out = renderSection({
      version: '1.0.0',
      previousTag: 'v0.9.0',
      date: 'd',
      repo,
      commits: [c('f'.repeat(40), 'feat!: new storage'), c('g'.repeat(40), 'fix: x', 'BREAKING CHANGE: y')],
    });
    expect(out.match(/### /g)).toEqual(['### ']);
    expect(out).toContain('### ⚠ BREAKING CHANGES');
  });

  it('says so when nothing is user-facing', () => {
    const out = renderSection({ version: '0.2.1', previousTag: 'v0.2.0', date: 'd', repo, commits: [c('h', 'ci: x')] });
    expect(out).toContain('No user-facing changes.');
  });
});

describe('changelog file helpers', () => {
  const log = '# Changelog\n\n## [0.1.0](u) (2026-09-17)\n\n### Features\n\n- first\n';

  it('prepends the newest section under the heading', () => {
    const out = prependSection(log, '## [0.2.0](u) (d)\n\n- second\n');
    expect(out.indexOf('0.2.0')).toBeLessThan(out.indexOf('0.1.0'));
    expect(out.startsWith('# Changelog\n\n## [0.2.0]')).toBe(true);
  });

  it('extracts one version section as release notes', () => {
    const out = prependSection(log, '## [0.2.0](u) (d)\n\n- second\n');
    expect(sectionFor(out, '0.2.0')).toBe('- second');
    expect(sectionFor(out, '0.1.0')).toBe('### Features\n\n- first');
    expect(sectionFor(out, '9.9.9')).toBeUndefined();
  });

  it('finds the newest final tag and ignores candidates', () => {
    expect(latestFinalTag(['v0.1.0', 'v0.10.0', 'v0.2.0', 'v0.11.0-rc.1', ''])).toBe('v0.10.0');
    expect(latestFinalTag(['v0.2.0-rc.1'])).toBeUndefined();
  });
});
