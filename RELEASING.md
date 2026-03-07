# Releasing Mesa Code Review CLI

This document covers the release flow for publishing new versions.

## Prerequisites

- `HOMEBREW_TAP_TOKEN` GitHub Actions secret with write access to
  `mesa-dot-dev/homebrew-tap`
- `NPM_TOKEN` GitHub Actions secret for npm publish

## Local Verification

Before releasing, verify the package locally:

    bun run brew:simulate

This builds, packs, extracts the tarball, installs dependencies, verifies all
WASM files are present, and runs smoke tests. The result in `.release/brew-simulate/`
is exactly what a Homebrew user gets.

## Automated Release

Use the GitHub workflow at `.github/workflows/release.yml`.

### Trigger

1. Bump `package.json` version and merge to `main`, or
2. Run the workflow manually via `workflow_dispatch`.

### What it does

- Detects version change in `package.json`
- Builds and packs the npm tarball
- Runs smoke tests (WASM files, `mesa --help`)
- Publishes to npm registry
- Uploads tarball to `mesa-dot-dev/homebrew-tap` releases
- Updates `Formula/code-review.rb` and `Formula/code-review@<version>.rb` on
  the `staged` branch via `mesa-dot-dev/homebrew-tap-action`
- The tap's `test-and-merge` workflow validates (`brew audit`, `brew style`,
  `brew install`) and promotes `staged -> main`

### Dry run

Run with `dry_run=true` to validate packaging and smoke tests without
publishing to npm, creating releases, or updating Homebrew.

## Post-release verification

    brew upgrade mesa-dot-dev/homebrew-tap/code-review
    mesa --help

Clean-slate test:

    brew uninstall --force code-review || true
    brew untap mesa-dot-dev/homebrew-tap || true
    brew install mesa-dot-dev/homebrew-tap/code-review
    mesa --help
