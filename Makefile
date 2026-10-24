# Run make release to consume pending changesets and publish to GitHub.
# Commit project changes and their changesets before releasing.

.PHONY: help build test dist release

help:
	@printf '%s\n' \
	  'make build    Build the game into dist/' \
	  'make test     Run the unit tests' \
	  'make dist     Test, build and package locally into releases/' \
	  'make release  Update changelog, test, build, consume changesets, commit and publish'

build:
	npm run build

test:
	npm test

dist:
	node scripts/release.mjs --package

release:
	node scripts/release.mjs
