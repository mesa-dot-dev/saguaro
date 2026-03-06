# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.9] - 2026-03-06

### Added

- 14 curated review rules in `.mesa/rules/` covering security, architecture, correctness, and error handling
- PreToolUse hook — injects relevant rules before Claude Code writes code
- Mesa self-review via `.mesa/config.yaml` and `.mcp.json`
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
- Configurable provider selection in `mesa init` onboarding
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
- Daemon added to `mesa init` onboarding flow

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

- Interactive TUI — launches when `mesa` is run without a subcommand
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
- `mesa model` command for interactive provider/model switching
- Model config enhancements (provider-specific settings in `.mesa/config.yaml`)
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

- Review history recording and `mesa stats` analytics view
- Toggle auto-review in config
- Rule generation integrated into `mesa init`
- Unified rule generation across CLI and MCP codepaths
- Rule generation and creation from MCP server

### Changed

- Migrated rule hosting to `.mesa/rules/` directory
- Simplified Claude Code skills integration
- Adapter passes codemaps to all review clients
- Faster rule generation

### Fixed

- Prevented Claude Code from calling review unnecessarily

## [0.2.3] - 2026-02-17

### Added

- MCP server for Claude Code integration (`mesa serve`)
- Stop hook for automatic reviews after agent writes code
- Hook install added to `mesa init`
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

- Initial CLI with `mesa review`, `mesa init`, and `mesa rules` commands
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
