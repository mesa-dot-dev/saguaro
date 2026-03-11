[![npm version](https://img.shields.io/npm/v/@mesadev/saguaro)](https://www.npmjs.com/package/@mesadev/saguaro)
[![CI](https://github.com/mesa-dot-dev/saguaro/actions/workflows/ci.yml/badge.svg)](https://github.com/mesa-dot-dev/saguaro/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

# Saguaro Local Review

Local code review for coding agents. Rules enforced inside Claude Code, Codex, and Cursor. Your agent fixes its own mistakes while context is hot. Free. Apache 2.0.

## Install

### npm (macOS + Linux, requires Node.js 20+)

```bash
npm install -g @mesadev/saguaro
```

Or run without installing:

```bash
npx @mesadev/saguaro review
```

### Homebrew (macOS)

```bash
brew install mesa-dot-dev/homebrew-tap/saguaro
```

### Shell script (macOS + Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/mesa-dot-dev/saguaro/main/install.sh | sh
```

---

Saguaro uses your existing agent CLI subscription (Claude Code, Codex, Gemini) when available, no API key needed. If no agent CLI is installed, set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` in your environment.

## Quickstart

```bash
# 1. Initialize Saguaro in your repo
sag init

# 2. Generate rules from your codebase (or use the starter rules)
sag rules generate

# 3. Run a review
sag review
```

`sag init` walks you through setup:
- Creates `.saguaro/config.yaml` and `.saguaro/rules/`
- Offers three options: generate rules from your codebase, use starter rules, or start from scratch
- Sets up Claude Code integration automatically (MCP server, hooks, slash commands)
- Stores your API key in `.env.local` if provided

## How It Works

1. **Match rules to files** — Rules load from `.saguaro/rules/` as markdown with YAML frontmatter. Changed files match against rule globs using minimatch. Rules without globs apply to all changed files.
2. **Gather context** — Saguaro builds an import graph (tree-sitter + SWC) showing the "blast radius" — files that depend on your changes and files your changes depend on. Context is token-budgeted so reviews stay fast.
3. **AI review per file** — Changed files batch together (configurable via `files_per_batch`). An AI agent checks each batch against matched rules with the diff and context. If a rule is violated, Saguaro prints it. If nothing is wrong, silence.

Violations exit 1. Clean reviews exit 0.

## Claude Code Integration

`sag init` sets up three things automatically:

### Hooks

Two hooks install into `.claude/settings.json`:

- **PreToolUse** — Fires before `Edit` and `Write` tool calls. Injects relevant rules so Claude knows your team's conventions before writing code.
- **Stop** — Fires when Claude finishes a turn. Saguaro diffs uncommitted changes against the base branch and reviews them. Violations block Claude and ask it to fix before completing.

```bash
sag hook install    # Enable (done by sag init)
sag hook uninstall  # Disable
```

### MCP Server

Saguaro registers as an MCP server via `.mcp.json`. Claude Code discovers it on startup and gains access to Saguaro's tools (review, create rules, generate rules).

### Slash Commands

| Command | What it does |
|---------|-------------|
| `/saguaro-review` | Run a code review manually |
| `/saguaro-createrule` | Create a new rule with AI assistance |
| `/saguaro-generaterules` | Auto-generate rules from your codebase |

## Other Agents

Saguaro works with any coding agent. The CLI is agent-agnostic.

| Agent | Integration |
|-------|-------------|
| **Codex CLI** | Run `sag review` manually or in CI |
| **Gemini CLI** | Same CLI and rules |
| **Cursor** | JSON output with deeplinks to violations (`--output json`, `cursor_deeplink: true` in config) |
| **CI pipelines** | `sag review --base origin/main` — exits 1 on violations |

## Background Daemon

For long-running agent sessions, the daemon runs classic senior engineer level reviews asynchronously in the background. Findings are advisory and surfaced on the next agent turn — independent of the rules review system.

```bash
sag daemon start    # Start the review daemon
sag daemon stop     # Stop it
sag daemon status   # Check if the daemon is running
```

The daemon runs an HTTP server with a SQLite-backed job queue and worker pool. The stop hook posts diffs to the daemon instead of running reviews inline. Workers claim jobs, spawn AI agents, and store results. The hook client polls for completion.

Enable in `.saguaro/config.yaml`:

```yaml
daemon:
  enabled: true
```

## Rules

Rules live in `.saguaro/rules/` as markdown files with YAML frontmatter. Each rule defines what to check, which files it applies to, and how severe a violation is.

````markdown
---
id: no-console-log
title: No console.log in production code
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
---

console.log, console.warn, and console.debug should not appear in
production code. Use a structured logging library instead.

### Violations

```
console.log("Processing order", orderId, customerEmail);
```

### Compliant

```
logger.info("Processing order", { orderId });
```
````

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier, kebab-case |
| `title` | Yes | Human-readable name |
| `severity` | Yes | `error` (blocks, exit 1), `warning` (logged), or `info` |
| `globs` | No | File patterns to match. Default: all files. Prefix `!` to exclude. |

The markdown body is the instruction the AI uses to evaluate the rule. Include `### Violations` and `### Compliant` sections with code examples.

Saguaro reviews any text file — rules are language-agnostic. The import graph supports TypeScript, JavaScript, Python, Go, Rust, Java, and Kotlin.

For a deep dive on writing effective rules, see [Writing Rules](docs/writing-rules.md).

## CLI Reference

| Command | Description |
|---------|-------------|
| `sag init` | Set up Saguaro in your repo (config, rules, hooks, integrations) |
| `sag review` | Review code changes against your rules |
| `sag rules generate` | Auto-generate rules by analyzing your codebase |
| `sag rules create [dir]` | Create a new rule with AI assistance, scoped to a directory |
| `sag rules list` | List all rules with IDs, titles, and severity |
| `sag rules explain <id>` | Show full details for a rule |
| `sag rules validate` | Check all rule files for correct structure |
| `sag rules delete <id>` | Delete a rule |
| `sag rules locate` | Print the path to the rules directory |
| `sag index` | Build the import graph for richer review context |
| `sag hook install` | Enable automatic reviews in Claude Code |
| `sag hook uninstall` | Disable automatic reviews |
| `sag daemon start` | Start the background review daemon |
| `sag daemon stop` | Stop the background review daemon |
| `sag daemon status` | Check if the daemon is running |
| `sag model` | Switch AI provider and model interactively |
| `sag stats` | Show review history and cost analytics |

### `sag review` Options

```
-m, --mode     Review mode: rules, classic, or full       [default: "rules"]
-b, --base     Base branch to diff against                [default: "main"]
    --head     Head ref to review                         [default: "HEAD"]
-o, --output   Output format: console, json               [default: "console"]
-v, --verbose  Show detailed progress                     [default: false]
    --debug    Write debug logs to .saguaro/.tmp/         [default: false]
-c, --config   Path to config file                        [default: ".saguaro/config.yaml"]
    --rules    Path to rules directory                    [default: ".saguaro/rules/"]
```

### `sag rules create` Options

```
sag rules create [target]

    target         Directory the rule targets (e.g. src/api)
    --intent       What the rule should enforce
    --severity     error, warning, or info
    --title        Rule title (auto-generated if omitted)
    --skip-preview Skip the file-match preview step
```

## Configuration

`.saguaro/config.yaml` is created by `sag init`:

```yaml
# AI model for reviews
model:
  provider: anthropic       # anthropic | openai | google
  name: sonnet              # CLI alias (e.g. "sonnet", "opus") or model ID

# Output settings
output:
  cursor_deeplink: true      # Print Cursor IDE links for violations

# Review tuning
review:
  max_steps: 10              # Max tool-calling steps per review batch
  files_per_batch: 2         # Files reviewed together per batch

# Hook settings
hook:
  enabled: true              # Master switch for all Saguaro hooks
  stop:
    enabled: true            # Rules review after each code change

# Background daemon (classic reviews)
# daemon:
#   enabled: true
```

API keys are loaded from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) or from `.env.local` / `.env` files.

### Pre-push Hook

```bash
#!/bin/bash
# .git/hooks/pre-push
sag review --base origin/main
```

## FAQ

**How is this different from CodeRabbit / Greptile / etc?**

Those tools are AI reviewers that comment on your PRs. Saguaro Local Review is a rules engine. You define what matters to your team, Saguaro enforces it during development — not after the code is already in a PR. No noise, no generic suggestions. If nothing is violated, you hear nothing.

**How much does it cost?**

You use your own API key. Cost depends on your model choice, codebase size, number of rules, and how often you run reviews. `sag stats` shows your usage history.

**Can I use it without Claude Code?**

Yes. The CLI works standalone. Run `sag review` from any terminal or CI pipeline. The Claude Code integration (hooks, MCP, slash commands) is optional.

**Where does my data go?**

Nowhere. Saguaro runs locally. Your code is sent to the AI provider you configure (Anthropic, OpenAI, Google) for review. Nothing touches Saguaro's servers.

**What languages are supported?**

Saguaro reviews any text file — rules are language-agnostic. The import graph supports TypeScript, JavaScript, Python, Go, Rust, Java, and Kotlin.

**Can I use it in CI?**

Yes. `sag review --base origin/main` exits 1 if violations are found. Use `--output json` for structured output.

**What AI providers are supported?**

Anthropic (Claude), OpenAI (GPT-4o, o3), and Google (Gemini).

**What's the background daemon?**

An optional async review system for long-running agent sessions. Runs classic (senior-engineer-style) reviews in parallel without blocking your agent. See [Background Daemon](#background-daemon).

## License

Apache-2.0.
