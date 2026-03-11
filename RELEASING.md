# Releasing Saguaro Code Review CLI

This document covers the release flow for publishing new versions.

## Prerequisites

- `HOMEBREW_TAP_TOKEN` GitHub Actions secret with write access to
  `mesa-dot-dev/homebrew-tap`
- `NPM_TOKEN` GitHub Actions secret for npm publish

## Local Verification

Before releasing, verify the compiled binary locally:

    bun run brew:verify

This compiles a binary with `bun build --compile`, copies WASM sidecar files,
and runs smoke tests. Then run the verified build:

    .release/sag --help
    .release/sag review

## Automated Release

Use the GitHub workflow at `.github/workflows/release.yml`.

### Trigger

1. Bump `package.json` version and merge to `main`, or
2. Run the workflow manually via `workflow_dispatch`.

### What it does

Two independent paths run in parallel:

**npm** (ubuntu):
- Builds and packs the npm tarball
- Runs smoke tests (WASM files via npm deps, `sag --help`)
- Publishes to npm registry

**Homebrew** (per-platform matrix):
- Compiles binaries with `bun build --compile` for darwin-arm64, linux-x64,
  linux-arm64
- Packages each binary with sidecar WASM files
- Uploads tarballs to `mesa-dot-dev/homebrew-tap` releases
- Generates and pushes `Formula/saguaro.rb` and
  `Formula/saguaro@<version>.rb` to the `staged` branch
- The tap's `test-and-merge` workflow validates (`brew audit`, `brew style`,
  `brew install`) and promotes `staged -> main`

### Dry run

Run with `dry_run=true` to validate packaging and smoke tests without
publishing to npm, creating releases, or updating Homebrew.

## Post-release verification

    brew upgrade mesa-dot-dev/homebrew-tap/saguaro
    sag --help

Clean-slate test:

    brew uninstall --force saguaro || true
    brew untap mesa-dot-dev/homebrew-tap || true
    brew install mesa-dot-dev/homebrew-tap/saguaro
    sag --help
