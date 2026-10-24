import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRevision, readChangelog } from './changesets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function run(command, args, { capture = false, cwd = root } = {}) {
  if (!capture) console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (...args) => run('git', args, { capture: true });
function version() {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  if (pkg.name !== 'pocket-world' || typeof pkg.version !== 'string' || !/^[1-9]\d*$/.test(pkg.version)) {
    throw new Error('Expected a pocket-world version as a positive integer string, without leading zeros.');
  }
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package.json and package-lock.json versions differ. Restore consistent package metadata before releasing.');
  }
  return pkg.version;
}

function requireCleanTree() {
  if (git('status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Commit your changes before make release, including new files.');
  }
}

function githubRepository() {
  const remotes = git('remote', 'get-url', '--push', '--all', 'origin').split('\n');
  if (remotes.length !== 1) throw new Error('origin must have exactly one push URL.');
  const url = new URL(remotes[0].replace(/^git@github\.com:/, 'https://github.com/'));
  const name = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
  if (url.hostname !== 'github.com' || !/^[\w.-]+\/[\w.-]+$/.test(name)) {
    throw new Error('origin must point to a GitHub repository.');
  }
  return name;
}

function releaseNotes(currentVersion, since = BigInt(currentVersion) - 1n) {
  const notes = readChangelog(root, currentVersion).filter(entry => entry.number > since)
    .map(entry => entry.line).join('\n');
  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${currentVersion}.`);
  return `${notes}\n\nDownload the web ZIP and upload its contents to your web host.\n`;
}

function packageBuild(currentVersion, notes) {
  if (!existsSync('dist/index.html')) throw new Error('The build did not produce dist/index.html.');
  const directory = resolve('releases', `v${currentVersion}`);
  mkdirSync(directory, { recursive: true });
  const name = `PocketWorld-${currentVersion}-web.zip`;
  const archive = join(directory, name);
  // Recreate the ZIP so removed files cannot survive from a previous build.
  rmSync(archive, { force: true });
  run('zip', ['-X', '-q', '-r', archive, '.'], { cwd: join(root, 'dist') });
  const checksum = join(directory, 'SHA256SUMS');
  writeFileSync(checksum, `${createHash('sha256').update(readFileSync(archive)).digest('hex')}  ${name}\n`);
  const notesFile = join(directory, 'release-notes.md');
  writeFileSync(notesFile, notes);
  console.log(`Packaged ${archive}`);
  return { archive, checksum, notesFile };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--package')) {
    throw new Error('Usage: node scripts/release.mjs [--package]');
  }
  const publish = args.length === 0;
  run('zip', ['-v'], { capture: true });
  let branch, repo, initialHead, releases;
  if (publish) {
    requireCleanTree();
    branch = git('branch', '--show-current');
    if (!branch) throw new Error('Check out a branch before make release.');
    initialHead = git('rev-parse', 'HEAD');
    repo = githubRepository();
    run('gh', ['auth', 'status', '--hostname', 'github.com'], { capture: true });
    releases = run('gh', ['api', `repos/${repo}/releases`, '--paginate', '--jq', '.[] | [.tag_name, .draft] | @tsv'], { capture: true });
  }

  const previousVersion = version();
  releaseNotes(previousVersion);
  run('npm', ['ci']);
  const revision = publish ? await prepareRevision(root, previousVersion) : null;
  const currentVersion = revision?.version ?? previousVersion;
  const tag = `v${currentVersion}`;
  let since = BigInt(currentVersion) - 1n;
  let draft = false;
  if (publish) {
    since = releases.split('\n').reduce((latest, line) => {
      const match = /^v([1-9]\d*)\tfalse$/.exec(line);
      const number = match ? BigInt(match[1]) : 0n;
      return number < BigInt(currentVersion) && number > latest ? number : latest;
    }, 0n);
    const release = releases.split('\n').find(line => line.split('\t')[0] === tag);
    if (release && release.split('\t')[1] !== 'true') {
      throw new Error(`${tag} is already published. Add a new changeset for the next release.`);
    }
    draft = Boolean(release);
    const remoteTag = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
      .split('\n').filter(Boolean);
    const tagCommit = remoteTag.find(line => line.endsWith('^{}')) ?? remoteTag[0];
    if (tagCommit && (revision || tagCommit.split(/\s/)[0] !== initialHead)) {
      throw new Error(`${tag} already points to another commit. Use a new version.`);
    }
    if (draft) {
      const target = run('gh', ['release', 'view', tag, '--repo', repo, '--json', 'targetCommitish', '--jq', '.targetCommitish'], { capture: true });
      if (revision || target !== initialHead) throw new Error(`The existing ${tag} draft belongs to another commit.`);
    }
    console.log(`Releasing ${tag} from ${branch} to ${repo}.`);
  }

  let staged = false;
  let committed = false;
  let artifacts;
  try {
    revision?.apply();
    const notes = releaseNotes(currentVersion, since);
    run('npm', ['test']);
    run('npm', ['run', 'build']);
    if (version() !== currentVersion) throw new Error('The project version changed during the build. Run the command again.');
    artifacts = packageBuild(currentVersion, notes);
    if (!publish) return;

    if (git('rev-parse', 'HEAD') !== initialHead || git('branch', '--show-current') !== branch) {
      throw new Error('The checked-out commit changed during the build. Run make release again.');
    }
    if (revision) {
      revision.assertUnchanged();
      const changed = git('diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
      const untracked = git('ls-files', '--others', '--exclude-standard');
      if (untracked || changed.some(file => !revision.files.includes(file))) {
        throw new Error('Unrelated files changed during release. Pending changesets have been kept.');
      }
      revision.consume();
      staged = true;
      run('git', ['add', '--', ...revision.files]);
      run('git', ['commit', '-m', `Release ${tag}`, '--', ...revision.files]);
      committed = true;
    }
    requireCleanTree();
  } catch (error) {
    if (!committed) {
      try {
        if (staged) git('restore', '--staged', '--', ...revision.files);
      } finally {
        revision?.rollback();
      }
    }
    throw error;
  }
  const { archive, checksum, notesFile } = artifacts;
  const head = git('rev-parse', 'HEAD');
  run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  if (draft) {
    run('gh', ['release', 'upload', tag, archive, checksum, '--repo', repo, '--clobber']);
    run('gh', ['release', 'edit', tag, '--repo', repo, '--notes-file', notesFile, '--draft=false', '--latest']);
  } else {
    run('gh', ['release', 'create', tag, archive, checksum, '--repo', repo, '--target', head,
      '--title', `Pocket World ${tag}`, '--notes-file', notesFile, '--latest']);
  }
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
}

try {
  await main();
} catch (error) {
  console.error(`Release stopped: ${error.message}`);
  process.exitCode = 1;
}
