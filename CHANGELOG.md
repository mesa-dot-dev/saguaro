# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.10] - 2026-03-09
- Moved documentation from `plans/` to `docs/` for better discoverability

## [0.4.9] - 2026-03-09

### Fixed

- Race condition where daemon findings and rules review findings were not merged; daemon would return early, preventing inline rules from running when both systems were enabled

## [0.4.8] - 2026-03-09

### Changed

- Removed `.mcp.json` from version control (already in `.gitignore`)
### Fixed

- Homebrew formula template path and version string processing in release workflow
- Homebrew installation failing due to libexec relocation
- Release pipeline permissions and job separation for npm and Homebrew publishing

## [0.4.1] - 2026-03-06

### Changed

- Dropped darwin-x64 build target; macOS releases now target arm64 only

### Fixed

- Review adapter skips git calls when test runtime is injected
- npm/Node.js distribution fixes for binary resolution

## [0.4.0] - 2026-03-06

### Added

- Shell script installer (`install.sh`) for macOS and Linux binary installs
- npm postinstall health check for native dependencies (better-sqlite3)
- Shared `isSaguaroOnPath()` / `resolveDistBin()` utilities in `src/util/resolve-bin.ts`

### Changed

- npm is now the primary install method; README reordered accordingly
- Shebang changed from `#!/usr/bin/env bun` to `#!/usr/bin/env node` for Node.js compatibility
- Binary path resolution uses `import.meta.url` instead of `findRepoRoot()` monorepo paths
- MCP config detection uses generic PATH lookup instead of Homebrew-specific prefix matching
- Test files excluded from `dist/` build output and npm package

### Fixed

- CLI and daemon failing to resolve `bin.js` when installed via npm (no longer assumes monorepo layout)
- Stale `packages/code-review/` references in comments and glob examples

## [0.3.9] - 2026-03-06

### Added

- 14 curated review rules in `.saguaro/rules/` covering security, architecture, correctness, and error handling
- PreToolUse hook — injects relevant rules before Claude Code writes code
- Saguaro self-review via `.saguaro/config.yaml` and `.mcp.json`
- `docs/commit-mining-findings.md` and README rewrite design docs

### Changed

- Rewrote README — shorter intro, added hook docs (PreToolUse + Stop), clearer "How It Works" section
- Config model setting no longer wipes inline YAML comments
- Removed contact email from CODE_OF_CONDUCT.md

### Fixed

- `setModel` in `src/config/catalog.ts` preserves existing config file comments

## [0.3.8] - 2026-03-06

Initial open-source release.

### Added

- Multi-provider support for classic reviews
- Improved Codex and Gemini provider support
- Verbose logging and debug capture for classic and dual reviews (`--verbose`, `--debug`)
- Configurable provider selection in `sag init` onboarding
- Multi-select support for bulk rule approval in Claude Code
- npm, Homebrew, and GitHub Releases distribution

### Changed

- Cleaned up review configs
- Improved review command descriptions and mode help text
- Simplified daemon error messages

## [0.3.5] - 2026-03-05

### Added

- Classic review mode — permissive senior-engineer review alongside rules mode
- Dual review mode (`full`) that runs both rules and classic together
- Spinner and progress UI for classic review CLI
- User-triggered daemon reviews
- Daemon added to `sag init` onboarding flow

### Changed

- Replaced "daemon" naming with "classic" throughout
- Better multi-select support in Claude Code

### Fixed

- Cross-session daemon review persistence

## [0.3.0] - 2026-03-02

### Added

- Codex and Gemini as review providers
- Default review agent set to Claude Code

### Changed

- Refactored code reviewer architecture

### Fixed

- Multi-session daemon review handling

## [0.2.9] - 2026-02-27

### Added

- Interactive TUI — launches when `sag` is run without a subcommand
- TUI screens for review, rules, stats, model selection, hook management, and index building

### Fixed

- TUI input field behavior
- Stop hook reliability

## [0.2.8] - 2026-02-26

### Added

- Background review daemon for coding agents
- Max process limit for daemon spawning
- Standalone CLI package

### Changed

- Cleaned up review logic
- Improved system prompt

## [0.2.7] - 2026-02-23

### Added

- Prebuilt binary CLI distribution (replaced Node.js runtime packaging)
- `sag model` command for interactive provider/model switching
- Model config enhancements (provider-specific settings in `.saguaro/config.yaml`)
- WASM tree-sitter parsers bundled with Homebrew formula
- Less noisy MCP success responses

### Changed

- Replaced Claude Code skill with stop hook
- Cleaned up blast radius calculation
- Cleaned up types system organization
- Refactored CLI MCP connection

### Fixed

- WASM bundling excluded correctly from CLI binary
- Native bindings resolved correctly in binary
- MCP CLI binary path resolution
- WASM directory symlink resolution

## [0.2.6] - 2026-02-20

### Added

- Provider and model selection during onboarding
- Documentation and examples

### Changed

- Reduced noise from rule generation tool calls
- Improved rule generation UX in Claude Code

## [0.2.5] - 2026-02-20

### Added

- Review history recording and `sag stats` analytics view
- Toggle auto-review in config
- Rule generation integrated into `sag init`
- Unified rule generation across CLI and MCP codepaths
- Rule generation and creation from MCP server

### Changed

- Migrated rule hosting to `.saguaro/rules/` directory
- Simplified Claude Code skills integration
- Adapter passes codemaps to all review clients
- Faster rule generation

### Fixed

- Prevented Claude Code from calling review unnecessarily

## [0.2.3] - 2026-02-17

### Added

- MCP server for Claude Code integration (`sag serve`)
- Stop hook for automatic reviews after agent writes code
- Hook install added to `sag init`
- Deduplication logic for review findings

### Changed

- Improved rule generation quality
- Better Homebrew install detection for MCP config
- Updated CLI help section

### Fixed

- Working directory resolution when generating rules
- Release template path

## [0.1.6] - 2026-02-16

### Added

- Skill templates for guided review workflows
- New AI-powered rule generation flow
- Enhanced rule creation with interactive prompts
- Eval suite with rubrics for testing rule quality

## [0.1.2] - 2026-02-13

Stabilization release — no new features.

## [0.0.11] - 2026-02-13

### Added

- Initial CLI with `sag review`, `sag init`, and `sag rules` commands
- AI code review engine with rules enforcement against diffs
- Parallel worker architecture for reviewing large changesets
- Basic rule generation from codebase analysis
- Default starter rules included during onboarding
- Local diff review by default (no remote required)
- Configurable parallel workers
- Codebase context collection for richer reviews
- Review progress events
- Homebrew distribution

### Changed

- Simplified review onboarding flow
- Refactored runner into adapter pattern
