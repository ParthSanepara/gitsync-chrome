// Release helpers for the release workflows (DECISIONS 0021). Needs full git history and tags.
//   node scripts/prepare-release.mjs bump 0.2.0   set package.json's version, add the CHANGELOG section
//   node scripts/prepare-release.mjs notes 0.2.0  print that version's CHANGELOG section (release notes)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { compareVersions, latestFinalTag, prependSection, renderSection, sectionFor } from './changelog.ts';

const root = new URL('../', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin').trim());
  if (!m) throw new Error('cannot tell the GitHub repository from the origin remote');
  return m[1];
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  return git('log', range, '--format=%H%x1f%s%x1f%b%x1e')
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', subject = '', body = ''] = r.split('\x1f');
      return { sha, subject, body };
    });
}

function bump(version) {
  const previousTag = latestFinalTag(git('tag', '--list', 'v*').split('\n'));
  if (previousTag && compareVersions(version, previousTag.slice(1)) <= 0)
    throw new Error(`${version} is not newer than the last release, ${previousTag}`);

  const pkgUrl = new URL('package.json', root);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n');

  const date = new Date().toISOString().slice(0, 10);
  const section = renderSection({ version, previousTag, date, repo: repoSlug(), commits: commitsSince(previousTag) });
  const logUrl = new URL('CHANGELOG.md', root);
  writeFileSync(logUrl, prependSection(readFileSync(logUrl, 'utf8'), section));
  process.stdout.write(section);
}

function notes(version) {
  const section = sectionFor(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version);
  if (section === undefined) throw new Error(`CHANGELOG.md has no section for ${version}`);
  process.stdout.write(section + '\n');
}

const [command, version] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('usage: prepare-release.mjs bump|notes X.Y.Z');
if (command === 'bump') bump(version);
else if (command === 'notes') notes(version);
else throw new Error(`unknown command: ${command}`);
