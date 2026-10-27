# Run make release to consume pending changesets and publish to GitHub and itch.io.

.PHONY: help build test dist release release-itch

help:
	@printf '%s\n' \
	  'make build    Build the game into dist/' \
	  'make test     Run the unit tests' \
	  'make dist     Test, build and package locally into releases/' \
	  'make release  Update changelog, build, consume changesets, commit and publish to GitHub and itch.io' \
	  'make release-itch  Retry the current packaged release on itch.io without rebuilding'

build:
	npm run build

test:
	npm test

dist:
	node scripts/release.mjs --package

release:
	git add -A
	git commit -m "fixes"
	git push
	node scripts/release.mjs

release-itch:
	node scripts/release.mjs --itch-only
