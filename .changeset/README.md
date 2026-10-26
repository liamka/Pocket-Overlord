# Changesets

Create a separate changeset after every project change, including documentation,
configuration and rule changes:

```sh
npm run changeset -- --patch pocket-overlord -m "Describe the change in English"
```

Keep each record until release. Do not append unrelated changes to an existing
record. Write a concise English summary; each changeset becomes one changelog line.

`make release` reads these standard Changesets files and adds their count to the
current integer version: `234` plus three changesets becomes `237`. It assigns
one number per changeset and prepends `- [#N] Description` lines to `CHANGELOG.md`,
newest first, under `# Changelog`. Records are numbered in filename order;
existing entries remain. There are no dates or category headings.
After checks and packaging succeed, it removes
the consumed records, commits the release files, pushes and publishes. Configuration
and this README remain. Failed checks preserve the pending records.

Use `make release` instead of `changeset version` or `changeset publish`: the
project uses integer versions and publishes a web game, not an npm package.
`make dist` leaves versions, the changelog and pending changesets untouched.

`make release` also uploads the packaged web build to
`liamka/pocket-overlord:html5` on itch.io using
[butler](https://itch.io/docs/butler/installing.html). Install butler and run
`butler login` once on each release machine (or set `BUTLER_API_KEY` in CI).
Credentials stay outside the repository. itch.io access is checked before the
build or release commit. The upload preserves the page's visibility, including Draft.

After the first upload to a new `html5` channel, select **This file will be played
in the browser** for that upload on the itch.io Edit game page and save it. This
is only needed once per channel. Release archives use relative asset paths so
the same ZIP works inside itch.io's embedded player.

If GitHub succeeds but itch.io fails, run `make release-itch` to retry the archive
in `releases/v<current-version>/`. It checks the archive's checksum and does not
rebuild, consume changesets, commit, push Git, or change the version.
