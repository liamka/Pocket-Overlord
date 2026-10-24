# Changesets

Create a separate changeset after every project change, including documentation,
configuration and rule changes:

```sh
npm run changeset -- --patch pocket-world -m "Describe the change in English"
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
