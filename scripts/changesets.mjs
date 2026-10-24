import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function summarize(changeset) {
  const lines = changeset.summary.split(/\r?\n/).map(line => line.trim());
  const summary = lines.filter(line => {
    if (!line.startsWith('#')) return true;
    if (!/^### (Added|Changed|Fixed|Removed)$/.test(line)) {
      throw new Error(`Unsupported heading in changeset ${changeset.id}: ${line}`);
    }
    return false;
  }).map(line => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean).join(' ');
  if (!summary) throw new Error(`Changeset ${changeset.id} must contain release notes, not just headings.`);
  return summary;
}

export function readChangelog(root, currentVersion) {
  const [heading, ...lines] = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
  if (heading !== '# Changelog') throw new Error('CHANGELOG.md must start with # Changelog.');
  const entries = lines.filter(line => line.trim()).map(line => {
    const match = /^- \[#([1-9]\d*)\] (\S.*)$/.exec(line);
    if (!match) throw new Error('Every CHANGELOG.md entry must use - [#N] Description.');
    return { number: BigInt(match[1]), line };
  });
  if (!entries.length || entries[0].number !== BigInt(currentVersion)) {
    throw new Error(`The newest CHANGELOG.md entry must use - [#${currentVersion}] Description.`);
  }
  if (entries.some((entry, index) => index > 0 && entry.number >= entries[index - 1].number)) {
    throw new Error('Changelog revision numbers must be unique and ordered newest first.');
  }
  return entries;
}

// Changesets owns the record format and parser. This adapter preserves the
// project's integer revision counter instead of applying SemVer bumps.
export async function prepareRevision(root, currentVersion) {
  const { readChangesets } = await import('@changesets/read');
  const changesets = (await readChangesets(root)).sort((a, b) => a.id.localeCompare(b.id));
  if (!changesets.length) return null;
  for (const { id, releases, summary } of changesets) {
    if (!summary.trim() || releases.length !== 1 || releases[0].name !== 'pocket-world' || releases[0].type !== 'patch') {
      throw new Error(`Changeset ${id} must have a nonempty summary and exactly one pocket-world patch release.`);
    }
  }
  const version = String(BigInt(currentVersion) + BigInt(changesets.length));
  const read = file => readFileSync(join(root, file), 'utf8');
  const files = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
  const before = new Map(files.map(file => [file, read(file)]));
  const pkg = JSON.parse(before.get('package.json'));
  const lock = JSON.parse(before.get('package-lock.json'));
  pkg.version = lock.version = lock.packages[''].version = version;
  const history = readChangelog(root, currentVersion).map(entry => entry.line);
  const entries = changesets.map((changeset, index) =>
    `- [#${BigInt(currentVersion) + BigInt(index + 1)}] ${summarize(changeset)}`).reverse();
  const after = new Map([
    ['package.json', `${JSON.stringify(pkg, null, 2)}\n`],
    ['package-lock.json', `${JSON.stringify(lock, null, 2)}\n`],
    ['CHANGELOG.md', `# Changelog\n\n${[...entries, ...history].join('\n')}\n`],
  ]);
  const records = new Map(changesets.map(({ id }) => {
    const file = `.changeset/${id}.md`;
    return [file, read(file)];
  }));
  let applied = false;
  const removed = new Set();
  return {
    version,
    files: [...files, ...records.keys()],
    apply() {
      applied = true;
      for (const [file, contents] of after) writeFileSync(join(root, file), contents);
    },
    assertUnchanged() {
      for (const [file, contents] of [...after, ...records]) {
        if (!existsSync(join(root, file)) || read(file) !== contents) {
          throw new Error(`${file} changed during release. Pending changesets have been kept.`);
        }
      }
    },
    consume() {
      this.assertUnchanged();
      for (const file of records.keys()) {
        unlinkSync(join(root, file));
        removed.add(file);
      }
    },
    rollback() {
      if (!applied) return;
      // Restore only our own writes; keep any concurrent user edits intact.
      for (const [file, contents] of before) {
        if (existsSync(join(root, file)) && read(file) === after.get(file)) writeFileSync(join(root, file), contents);
      }
      for (const file of removed) {
        if (!existsSync(join(root, file))) writeFileSync(join(root, file), records.get(file));
      }
    },
  };
}
