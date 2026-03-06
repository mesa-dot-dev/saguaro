# Releasing Mesa Code Review CLI

This document covers the full release flow for publishing a new Homebrew version
of the code-review CLI.

## Prerequisites

- `HOMEBREW_TAP_TOKEN` GitHub Actions secret exists in this repo
- Token has write access to `mesa-dot-dev/homebrew-tap`

## Automated Release (Preferred)

Use the GitHub workflow at `.github/workflows/release.yml`.

### Trigger via GitHub Actions

1. Bump `package.json` version and merge to `main`, or
2. Run the workflow manually (`workflow_dispatch`) and set `version`.

The workflow will:

- build the package and create platform-specific binaries
- run smoke checks (`mesa --help`, `mesa index` in a temp git repo)
- create release assets in `mesa-dot-dev/homebrew-tap`
- update `Formula/code-review.rb` and `Formula/code-review@<version>.rb` on
  the `staged` branch via `mesa-dot-dev/homebrew-tap-action`
- rely on `homebrew-tap`'s `test-and-merge` workflow to validate and promote
  `staged -> main`

### Dry run

Run `Release Code Review CLI` with `dry_run=true` to validate packaging/smoke
tests without creating a GitHub release or updating Homebrew formulae.

Dry run still validates the important release path:

- tarball creation
- checksum generation
- installability smoke test
- command smoke checks

If dry-run fails, stop and fix before running a real release.

## Post-release verification

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
