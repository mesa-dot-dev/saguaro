# Releasing Mesa Code Review CLI

This document covers the full release flow for publishing a new Homebrew version
of the code-review CLI.

## Prerequisites

- `bun`, `node`, `npm`, `git` installed
- `gh` authenticated (`gh auth status`)

## Automated Release (Preferred)

Use the GitHub workflow at `.github/workflows/release-code-review.yml`.

### Trigger via GitHub Actions

1. Bump `packages/code-review/package.json` version and merge to `main`, or
2. Run the workflow manually (`workflow_dispatch`) and set `version`.

The workflow will:

- run `scripts/release-code-review.sh`
- create release assets in `mesa-dot-dev/homebrew-tap`
- update `Formula/code-review.rb` and `Formula/code-review@<version>.rb` on
  the `staged` branch via `mesa-dot-dev/homebrew-tap-action`
- rely on `homebrew-tap`'s `test-and-merge` workflow to validate and promote
  `staged -> main`

### Dry run

Run `Release Code Review CLI` with `dry_run=true` to validate packaging/smoke
tests without updating Homebrew formulae.

## Manual Fallback

If workflow automation is unavailable, use the manual process below.

## 1) Bump Version in depot

Update `packages/code-review/package.json` to the new version.

Example:

```json
"version": "0.0.5"
```

## 2) Run Release Dry Run

From depot root:

```bash
bun run code-review:release -- --dry-run
```

This will:

- pack `packages/code-review` into `mesa-code-review-<version>.tgz`
- run smoke checks (`mesa --help`, `mesa index` in a temp git repo)
- print the formula values to use (`version`, `url`, `sha256`)
- skip GitHub upload

If dry-run fails, stop and fix before continuing.

## 3) Publish Real Release

From depot root:

```bash
bun run code-review:release
```

This creates a release in `mesa-dot-dev/homebrew-tap` with tag:

```bash
mesa-code-review-v<version>
```

and uploads:

- `mesa-code-review-<version>.tgz`
- `checksums.txt`

## 4) Update Homebrew Formula

Clone and Edit:
- clone: https://github.com/mesa-dot-dev/homebrew-tap.git
- `~/homebrew-tap/Formula/code-review.rb`

Set the `url` and `sha256` to the values printed by the release command.

## 5) Validate Formula Locally

From `homebrew-tap` root:

```bash
brew style Formula/code-review.rb
brew audit --strict mesa-dot-dev/homebrew-tap/code-review
```

## 6) Push Formula to staged

From `homebrew-tap` root:

```bash
git checkout -b code-review-release-<version>
git add Formula/code-review.rb
git commit -m "code-review <version>"
git push -u origin HEAD
git push origin HEAD:staged
```

`test-and-merge` runs on `staged` and merges into `main` if green.

## 7) Fresh Install Verification

```bash
brew upgrade mesa-dot-dev/homebrew-tap/code-review
mesa --v
```

Optional clean-slate test:

```bash
brew uninstall --force code-review || true
brew untap mesa-dot-dev/homebrew-tap || true
brew install mesa-dot-dev/homebrew-tap/code-review
mesa --help
```
