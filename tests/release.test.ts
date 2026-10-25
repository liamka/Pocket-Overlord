import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const originalHead = 'a'.repeat(40);

// Exercise the real release CLI and ZIP packaging, with Git, npm and GitHub
// replaced at the process boundary. These tests cannot publish or push.
const commandStub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync('scenario.json', 'utf8'));
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const tag = 'v' + JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
fs.appendFileSync('commands.jsonl', JSON.stringify([command, ...args]) + '\\n');
const save = () => fs.writeFileSync('state.json', JSON.stringify(state));
const output = value => process.stdout.write(value);
const fail = () => { console.error('Simulated failure'); process.exit(1); };
if (command === 'git') {
  switch (args[0]) {
    case 'status': output(config.dirty || state.dirty ? ' M src/main.ts' : ''); break;
    case 'branch': output(config.detached ? '' : 'main'); break;
    case 'rev-parse': output(state.head); break;
    case 'remote': output('https://github.com/example/pocket-overlord.git'); break;
    case 'ls-remote': if (config.tagConflict) output('c'.repeat(40) + '\\trefs/tags/' + tag); break;
    case 'diff': output(state.dirty ? 'src/main.ts\\0' : 'package.json\\0package-lock.json\\0CHANGELOG.md\\0'); break;
    case 'ls-files': output(config.newFile ? 'new-file.txt' : ''); break;
    case 'add': break;
    case 'restore': if (config.restoreFailure) fail(); break;
    case 'commit':
      if (config.commitFailure) fail();
      state.head = 'b'.repeat(40); save(); break;
    case 'push': if (config.pushFailure) fail(); break;
    default: throw new Error('Unexpected Git command: ' + args.join(' '));
  }
} else if (command === 'gh') {
  if (args[0] === 'auth') { if (config.authFailure) fail(); }
  else if (args[0] === 'api') {
    if (config.apiFailure) fail();
    if (state.previousPublished !== '0') output('v' + state.previousPublished + '\\tfalse\\n');
    if (config.published) output(tag + '\\tfalse');
    else if (state.draft) output(tag + '\\ttrue');
  } else if (args[1] === 'view') output(config.draftConflict ? 'c'.repeat(40) : state.head);
  else if (args[1] === 'create' && config.uploadFailure && !state.failedOnce) {
    state.failedOnce = true; state.draft = true; save(); fail();
  } else if (!['create', 'upload', 'edit'].includes(args[1])) throw new Error('Unexpected GitHub command');
} else if (command === 'npm') {
  if (args[0] === 'ci') { if (config.installFailure) fail(); }
  else if (args[0] === 'test') { if (config.testFailure) fail(); }
  else if (args[1] === 'build') {
    if (config.buildFailure) fail();
    fs.mkdirSync('dist', {recursive: true});
    fs.writeFileSync('dist/index.html', '<title>Pocket Overlord</title>' + tag);
    fs.writeFileSync('dist/game.js', 'console.log("built");');
    if (config.headChanged) {state.head = 'c'.repeat(40); save();}
    if (config.unexpectedChange) {state.dirty = true; save();}
    if (config.versionChanged) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      pkg.version = lock.version = lock.packages[''].version = '999';
      fs.writeFileSync('package.json', JSON.stringify(pkg));
      fs.writeFileSync('package-lock.json', JSON.stringify(lock));
    }
    if (config.changesetChanged) fs.appendFileSync('.changeset/first.md', '\\nConcurrent edit.\\n');
  } else throw new Error('Unexpected npm command');
}
`;

function fixture(scenario: Record<string, boolean> = {}, version = '234') {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-overlord-release-'));
  directories.push(directory);
  mkdirSync(join(directory, 'scripts'));
  mkdirSync(join(directory, 'bin'));
  mkdirSync(join(directory, '.changeset'));
  symlinkSync(new URL('../node_modules', import.meta.url), join(directory, 'node_modules'), 'dir');
  copyFileSync(new URL('../scripts/release.mjs', import.meta.url), join(directory, 'scripts/release.mjs'));
  copyFileSync(new URL('../scripts/changesets.mjs', import.meta.url), join(directory, 'scripts/changesets.mjs'));
  copyFileSync(new URL('../.changeset/config.json', import.meta.url), join(directory, '.changeset/config.json'));
  copyFileSync(new URL('../.changeset/README.md', import.meta.url), join(directory, '.changeset/README.md'));
  copyFileSync(new URL('../Makefile', import.meta.url), join(directory, 'Makefile'));
  for (const command of ['git', 'npm', 'gh']) {
    const file = join(directory, 'bin', command);
    writeFileSync(file, commandStub);
    chmodSync(file, 0o755);
  }
  writeFileSync(join(directory, 'scenario.json'), JSON.stringify(scenario));
  const previous = /^[1-9]\d*$/.test(version) ? String(BigInt(version) - 1n) : '0';
  writeFileSync(join(directory, 'state.json'), JSON.stringify({ head: originalHead, previousPublished: previous }));
  writeFileSync(join(directory, 'commands.jsonl'), '');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'pocket-overlord', version }));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version: scenario.versionMismatch ? '233' : version } } }));
  writeFileSync(join(directory, 'CHANGELOG.md'), `# Changelog\n\n- [#${version}] Current change.\n${previous === '0' ? '' : `- [#${previous}] Older change.\n`}`);
  return {
    directory,
    addChangeset: (name: string, summary: string) => {
      writeFileSync(join(directory, '.changeset', `${name}.md`), `---\n"pocket-overlord": patch\n---\n\n${summary}\n`);
      const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
      state.previousPublished = version;
      writeFileSync(join(directory, 'state.json'), JSON.stringify(state));
    },
    run: (target = 'release') => spawnSync('make', [target], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
    }),
    commands: (): string[][] => readFileSync(join(directory, 'commands.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('make release', () => {
  it('numbers each changeset separately and adds their count to the version', () => {
    const test = fixture({}, '9');
    const previousChangelog = readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8');
    test.addChangeset('first', '### Added\n- First addition.\n\n### Fixed\n- Corrected a bug.');
    test.addChangeset('second', 'Second change.');
    test.addChangeset('third', '### Removed\n- Removed an obsolete feature.');
    const result = test.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(test.directory, 'package-lock.json'), 'utf8'));
    expect([pkg.version, lock.version, lock.packages[''].version]).toEqual(['12', '12', '12']);
    const changelog = readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8');
    const newEntries = '- [#12] Removed an obsolete feature.\n- [#11] Second change.\n- [#10] First addition. Corrected a bug.\n';
    expect(changelog).toBe(`# Changelog\n\n${newEntries}${previousChangelog.replace('# Changelog\n\n', '')}`);
    expect(readdirSync(join(test.directory, '.changeset')).sort()).toEqual(['README.md', 'config.json']);
    const notes = readFileSync(join(test.directory, 'releases/v12/release-notes.md'), 'utf8');
    expect(notes).toContain(newEntries);
    expect(notes).not.toContain('###');
    expect(notes).not.toContain('Current change.');
    expect(readFileSync(join(test.directory, 'dist/index.html'), 'utf8')).toContain('v12');
    const commands = test.commands();
    const commit = commands.findIndex(command => command[0] === 'git' && command[1] === 'commit');
    expect(commit).toBeGreaterThan(commands.findIndex(command => command.join(' ') === 'npm run build'));
    expect(commands[commit]).toEqual(expect.arrayContaining(['Release v12', '.changeset/first.md', '.changeset/second.md', '.changeset/third.md']));
    expect(commands.find(command => command[0] === 'gh' && command[2] === 'create')).toEqual(expect.arrayContaining(['v12', '--target', 'b'.repeat(40)]));
  });

  it.each(['buildFailure', 'headChanged', 'unexpectedChange', 'newFile', 'commitFailure'])('preserves changesets and restores metadata after %s', failure => {
    const test = fixture({ [failure]: true });
    test.addChangeset('first', 'Keep this change.');
    const files = ['package.json', 'package-lock.json', 'CHANGELOG.md', '.changeset/first.md'];
    const before = files.map(file => readFileSync(join(test.directory, file), 'utf8'));
    expect(test.run().status).not.toBe(0);
    expect(files.map(file => readFileSync(join(test.directory, file), 'utf8'))).toEqual(before);
    expect(test.commands().some(command => command[0] === 'git' && command[1] === 'push')).toBe(false);
  });

  it('preserves a concurrent changeset edit instead of consuming it', () => {
    const test = fixture({ changesetChanged: true });
    test.addChangeset('first', 'Original change.');
    const result = test.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('changed during release');
    expect(readFileSync(join(test.directory, '.changeset/first.md'), 'utf8')).toContain('Concurrent edit.');
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('234');
  });

  it('restores changeset files even if Git cannot restore the index after a failed commit', () => {
    const test = fixture({ commitFailure: true, restoreFailure: true });
    test.addChangeset('first', 'Keep the pending change.');
    expect(test.run().status).not.toBe(0);
    expect(readFileSync(join(test.directory, '.changeset/first.md'), 'utf8')).toContain('Keep the pending change.');
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('234');
    expect(test.commands().some(command => command[0] === 'git' && command[1] === 'push')).toBe(false);
  });

  it('rejects a record containing only headings even when another record has release notes', () => {
    const test = fixture();
    test.addChangeset('first', 'A valid change.');
    test.addChangeset('second', '### Added');
    expect(test.run().status).not.toBe(0);
    expect(existsSync(join(test.directory, '.changeset/first.md'))).toBe(true);
    expect(existsSync(join(test.directory, '.changeset/second.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('234');
  });

  it('can retry an interrupted release without consuming records or incrementing twice', () => {
    const test = fixture({ uploadFailure: true });
    test.addChangeset('first', 'A single revision.');
    test.addChangeset('second', 'Another revision.');
    test.addChangeset('third', 'The latest revision.');
    expect(test.run().status).not.toBe(0);
    const changelog = readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8');
    const notes = readFileSync(join(test.directory, 'releases/v237/release-notes.md'), 'utf8');
    expect(existsSync(join(test.directory, '.changeset/first.md'))).toBe(false);
    expect(test.run().status).toBe(0);
    expect(readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8')).toBe(changelog);
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('237');
    expect(readFileSync(join(test.directory, 'releases/v237/release-notes.md'), 'utf8')).toBe(notes);
    expect(notes).toContain('- [#235] A single revision.');
    expect(notes).toContain('- [#236] Another revision.');
    expect(notes).toContain('- [#237] The latest revision.');
    expect(test.commands().filter(command => command[0] === 'git' && command[1] === 'commit')).toHaveLength(1);
  });

  it.each(['---\n---\nEmpty release.', '---\n"other-package": patch\n---\nWrong package.', '---\n"pocket-overlord": minor\n---\nWrong bump.', '---\n"pocket-overlord": patch\n---\n', '---\n"pocket-overlord": patch\n---\n### Unknown\n- Wrong heading.'])('rejects unsupported changesets without losing records', record => {
    const test = fixture();
    writeFileSync(join(test.directory, '.changeset/invalid.md'), record);
    expect(test.run().status).not.toBe(0);
    expect(readFileSync(join(test.directory, '.changeset/invalid.md'), 'utf8')).toBe(record);
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('234');
    expect(test.commands().some(command => command[0] === 'git' && ['add', 'commit', 'push'].includes(command[1]))).toBe(false);
  });

  it('does not consume pending changesets during local packaging', () => {
    const test = fixture();
    test.addChangeset('first', 'Pending change.');
    const before = readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8');
    expect(test.run('dist').status).toBe(0);
    expect(existsSync(join(test.directory, '.changeset/first.md'))).toBe(true);
    expect(readFileSync(join(test.directory, 'CHANGELOG.md'), 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(join(test.directory, 'package.json'), 'utf8')).version).toBe('234');
  });

  it('packages the actual build with its checksum and publishes at the pushed commit', () => {
    const test = fixture();
    const result = test.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const commands = test.commands();
    expect(commands.some(command => command[0] === 'git' && command[1] === 'commit')).toBe(false);
    const push = commands.findIndex(command => command[0] === 'git' && command[1] === 'push');
    const create = commands.findIndex(command => command[0] === 'gh' && command[1] === 'release' && command[2] === 'create');
    expect(push).toBeGreaterThan(commands.findIndex(command => command.join(' ') === 'npm run build'));
    expect(create).toBeGreaterThan(push);
    expect(commands[push]).toEqual(['git', 'push', 'origin', 'HEAD:refs/heads/main']);
    expect(commands[create]).toEqual(expect.arrayContaining(['v234', '--target', originalHead, '--repo', 'example/pocket-overlord', '--notes-file']));
    const directory = join(test.directory, 'releases/v234');
    const name = 'PocketOverlord-234-web.zip';
    const archive = readFileSync(join(directory, name));
    expect(readFileSync(join(directory, 'SHA256SUMS'), 'utf8')).toBe(`${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
    const contents = spawnSync('unzip', ['-Z', '-1', join(directory, name)], { encoding: 'utf8' });
    expect(contents.status).toBe(0);
    expect(contents.stdout.trim().split('\n').sort()).toEqual(['game.js', 'index.html']);
    const notes = readFileSync(join(directory, 'release-notes.md'), 'utf8');
    expect(notes).toContain('Current change.');
    expect(notes).toContain('- [#234] Current change.');
    expect(notes).not.toContain('Older change.');
  });

  it('uses the prepared version and changelog without rewriting files or making commits', () => {
    const test = fixture();
    const files = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
    const before = files.map(file => readFileSync(join(test.directory, file), 'utf8'));
    expect(test.run().status).toBe(0);
    const commands = test.commands();
    expect(commands.filter(command => command[0] === 'npm')).toEqual([['npm', 'ci'], ['npm', 'run', 'build']]);
    expect(commands.some(command => command[0] === 'git' && ['add', 'commit'].includes(command[1]))).toBe(false);
    expect(files.map(file => readFileSync(join(test.directory, file), 'utf8'))).toEqual(before);
  });

  it.each([false, true])('releases without requiring tests (pending changesets: %s)', pending => {
    const test = fixture({ testFailure: true });
    if (pending) test.addChangeset('first', 'Release without running tests.');
    expect(test.run().status).toBe(0);
    expect(test.commands()).not.toContainEqual(['npm', 'test']);
    expect(test.commands()).toContainEqual(['npm', 'run', 'build']);
    expect(test.commands().some(command => command[0] === 'gh' && command[2] === 'create')).toBe(true);
  });

  it('still requires tests for local packaging', () => {
    const test = fixture({ testFailure: true });
    expect(test.run('dist').status).not.toBe(0);
    expect(test.commands()).toContainEqual(['npm', 'test']);
    expect(test.commands()).not.toContainEqual(['npm', 'run', 'build']);
  });

  it.each(['dirty', 'detached', 'authFailure', 'apiFailure', 'versionMismatch', 'versionChanged', 'published', 'tagConflict', 'installFailure', 'buildFailure', 'headChanged', 'unexpectedChange'])('stops before any push or publication on %s', failure => {
    const test = fixture({ [failure]: true });
    expect(test.run().status).not.toBe(0);
    expect(test.commands().some(command => command[0] === 'git' && ['commit', 'push'].includes(command[1]))).toBe(false);
    expect(test.commands().some(command => command[0] === 'gh' && ['create', 'upload', 'edit'].includes(command[2]))).toBe(false);
  });

  it.each(['1', '9', '10', '9007199254740993'])('packages integer revision %s without adding version components', version => {
    const test = fixture({}, version);
    expect(test.run('dist').status).toBe(0);
    expect(readFileSync(join(test.directory, `releases/v${version}/SHA256SUMS`), 'utf8')).toContain(`PocketOverlord-${version}-web.zip`);
  });

  it.each(['0', '01', '-1', '1.234', '1.2.3', '234-beta', 'v234'])('rejects unsupported version %s before publishing', version => {
    const test = fixture({}, version);
    const result = test.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('version as a positive integer string');
    expect(test.commands().some(command => command[0] === 'git' && command[1] === 'push')).toBe(false);
  });

  it.each([
    '# Changelog\n\n- [#233] Wrong revision.\n',
    '# Changelog\n\n## [234] - 2026-10-24\n\n### Added\n- Old format.\n',
    '# Changelog\n\n- [#234] \n',
    '# Changelog\n\n- [#235] Newer entry.\n- [#234] Old entry.\n',
    '# Changelog\n\n- [#234] Current.\n- [#234] Duplicate.\n',
    '# Changelog\n\n- [#234] Current.\n- [#232] Older.\n- [#233] Unordered.\n',
  ])('rejects invalid, empty, duplicate or unordered changelog entries', changelog => {
    const test = fixture();
    writeFileSync(join(test.directory, 'CHANGELOG.md'), changelog);
    expect(test.run().status).not.toBe(0);
    expect(test.commands().some(command => command[0] === 'git' && command[1] === 'push')).toBe(false);
  });

  it('does not create a release if pushing the branch fails', () => {
    const test = fixture({ pushFailure: true });
    expect(test.run().status).not.toBe(0);
    expect(test.commands().some(command => command[0] === 'gh' && command[2] === 'create')).toBe(false);
  });

  it('completes a matching draft after an interrupted upload without creating a second release', () => {
    const test = fixture({ uploadFailure: true });
    expect(test.run().status).not.toBe(0);
    expect(test.run().status).toBe(0);
    const commands = test.commands();
    expect(commands.filter(command => command[0] === 'gh' && command[2] === 'create')).toHaveLength(1);
    expect(commands.find(command => command[0] === 'gh' && command[2] === 'upload')).toContain('--clobber');
    expect(commands.find(command => command[0] === 'gh' && command[2] === 'edit')).toContain('--draft=false');
  });

  it('does not overwrite a draft made for another commit', () => {
    const test = fixture({ uploadFailure: true, draftConflict: true });
    expect(test.run().status).not.toBe(0);
    expect(test.run().status).not.toBe(0);
    expect(test.commands().some(command => command[0] === 'gh' && ['upload', 'edit'].includes(command[2]))).toBe(false);
  });

  it('keeps make dist local and replaces old archives instead of retaining removed files', () => {
    const test = fixture({ dirty: true, authFailure: true });
    expect(test.run('dist').status).toBe(0);
    writeFileSync(join(test.directory, 'dist/removed.txt'), 'old asset');
    expect(test.run('dist').status).toBe(0);
    rmSync(join(test.directory, 'dist/removed.txt'));
    expect(test.run('dist').status).toBe(0);
    const listing = spawnSync('unzip', ['-Z', '-1', join(test.directory, 'releases/v234/PocketOverlord-234-web.zip')], { encoding: 'utf8' });
    expect(listing.stdout).not.toContain('removed.txt');
    expect(test.commands().some(command => ['git', 'gh'].includes(command[0]))).toBe(false);
  });
});
