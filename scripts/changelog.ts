// Changelog sections from conventional commits, in the format release-please used to write
// (DECISIONS 0021). Pure: `prepare-release.mjs` does the git and file work.

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

interface Entry {
  type: string;
  breaking: boolean;
  description: string;
  sha: string;
}

const HEADER = /^(\w+)(?:\([^)]*\))?(!)?: (.+)$/;
const OVERRIDE = /BEGIN_COMMIT_OVERRIDE\n([\s\S]*?)\nEND_COMMIT_OVERRIDE/;

const SECTIONS: Array<{ title: string; take: (e: Entry) => boolean }> = [
  { title: '⚠ BREAKING CHANGES', take: (e) => e.breaking },
  { title: 'Features', take: (e) => !e.breaking && e.type === 'feat' },
  { title: 'Bug Fixes', take: (e) => !e.breaking && e.type === 'fix' },
  { title: 'Performance Improvements', take: (e) => !e.breaking && e.type === 'perf' },
];

/** One entry per conventional line. A `BEGIN_COMMIT_OVERRIDE` block in the body replaces the subject. */
function entries(commits: Commit[]): Entry[] {
  return commits.flatMap((c) => {
    const override = OVERRIDE.exec(c.body.replace(/\r\n/g, '\n'));
    const lines = override?.[1] ? override[1].split('\n') : [c.subject];
    const breakingFooter = /^BREAKING[ -]CHANGE: /m.test(c.body);
    return lines.flatMap((line): Entry[] => {
      const m = HEADER.exec(line.trim());
      if (!m?.[1] || !m[3]) return [];
      return [{ type: m[1], breaking: m[2] === '!' || breakingFooter, description: m[3], sha: c.sha }];
    });
  });
}

export function renderSection(opts: {
  version: string;
  previousTag: string | undefined;
  date: string;
  repo: string;
  commits: Commit[];
}): string {
  const { version, previousTag, date, repo, commits } = opts;
  const url = `https://github.com/${repo}`;
  const title = previousTag ? `[${version}](${url}/compare/${previousTag}...v${version})` : version;
  const all = entries(commits);
  const parts = [`## ${title} (${date})`];
  for (const s of SECTIONS) {
    const picked = all.filter(s.take);
    if (picked.length === 0) continue;
    parts.push(`### ${s.title}`);
    parts.push(picked.map((e) => `- ${e.description} ([${e.sha.slice(0, 7)}](${url}/commit/${e.sha}))`).join('\n'));
  }
  if (parts.length === 1) parts.push('No user-facing changes.');
  return parts.join('\n\n') + '\n';
}

/** Adds `section` as the newest entry, right under the `# Changelog` heading. */
export function prependSection(changelog: string, section: string): string {
  const heading = '# Changelog\n';
  const rest = changelog.startsWith(heading) ? changelog.slice(heading.length).replace(/^\n+/, '') : changelog;
  return `${heading}\n${section}\n${rest}`;
}

/** The section for `version`, without its heading: the body of that version's GitHub release. */
export function sectionFor(changelog: string, version: string): string | undefined {
  const lines = changelog.split('\n');
  const start = lines.findIndex(
    (l) => /^## /.test(l) && (l.includes(`[${version}]`) || l.startsWith(`## ${version} `)),
  );
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

/** Newest `vX.Y.Z` tag, ignoring release candidates (`vX.Y.Z-rc.N`). */
export function latestFinalTag(tags: string[]): string | undefined {
  const finals = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return finals.sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
