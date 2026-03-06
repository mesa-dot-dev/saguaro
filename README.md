[![npm version](https://img.shields.io/npm/v/@mesadev/code-review)](https://www.npmjs.com/package/@mesadev/code-review)
[![CI](https://github.com/mesa-dot-dev/code-review/actions/workflows/ci.yml/badge.svg)](https://github.com/mesa-dot-dev/code-review/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

# Mesa Code Review CLI

Rules enforced inside Claude Code, Codex, and Cursor. Your agent fixes its own mistakes while context is hot. Free. Apache 2.0.

## Install

### Homebrew (macOS)

```bash
brew install mesa-dot-dev/homebrew-tap/code-review
```

### npm

```bash
npm install -g @mesadev/code-review
```

Or run without installing:

```bash
npx @mesadev/code-review review
```

### GitHub Releases

Download prebuilt binaries from [Releases](https://github.com/mesa-dot-dev/code-review/releases).

---

Requires an API key for your chosen provider. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` in your environment, or paste it during `mesa init`.

## Quickstart

```bash
# 1. Initialize Mesa in your repo
mesa init

# 2. Generate rules from your codebase (or use the starter rules)
mesa rules generate

# 3. Run a review
mesa review
```

`mesa init` walks you through setup:
- Creates `.mesa/config.yaml` and `.mesa/rules/`
- Offers three options: generate rules from your codebase, use starter rules, or start from scratch
- Sets up Claude Code integration automatically (MCP server, hooks, slash commands)
- Stores your API key in `.env.local` if provided

## How It Works

1. **Match rules to files** — Rules load from `.mesa/rules/` as markdown with YAML frontmatter. Changed files match against rule globs using minimatch. Rules without globs apply to all changed files.
2. **Gather context** — Mesa builds an import graph (tree-sitter + SWC) showing the "blast radius" — files that depend on your changes and files your changes depend on. Context is token-budgeted so reviews stay fast.
3. **AI review per file** — Changed files batch together (configurable via `files_per_batch`). An AI agent checks each batch against matched rules with the diff and context. If a rule is violated, Mesa prints it. If nothing is wrong, silence.

Violations exit 1. Clean reviews exit 0.

## Claude Code Integration

`mesa init` sets up three things automatically:

### Hooks

Two hooks install into `.claude/settings.json`:

- **PreToolUse** — Fires before `Edit` and `Write` tool calls. Injects relevant rules so Claude knows your team's conventions before writing code.
- **Stop** — Fires when Claude finishes a turn. Mesa diffs uncommitted changes against the base branch and reviews them. Violations block Claude and ask it to fix before completing.

```bash
mesa hook install    # Enable (done by mesa init)
mesa hook uninstall  # Disable
```

### MCP Server

Mesa registers as an MCP server via `.mcp.json`. Claude Code discovers it on startup and gains access to Mesa's tools (review, create rules, generate rules).

### Slash Commands

| Command | What it does |
|---------|-------------|
| `/mesa-review` | Run a code review manually |
| `/mesa-createrule` | Create a new rule with AI assistance |
| `/mesa-generaterules` | Auto-generate rules from your codebase |

## Other Agents

Mesa works with any coding agent. The CLI is agent-agnostic.

| Agent | Integration |
|-------|-------------|
| **Codex CLI** | Run `mesa review` manually or in CI |
| **Gemini CLI** | Same CLI and rules |
| **Cursor** | JSON output with deeplinks to violations (`--output json`, `cursor_deeplink: true` in config) |
| **CI pipelines** | `mesa review --base origin/main` — exits 1 on violations |

## Background Daemon

For long-running agent sessions, the daemon reviews changes asynchronously without blocking your agent.

```bash
mesa daemon start   # Start the review daemon
mesa daemon stop    # Stop it
```

The daemon runs an HTTP server with a SQLite-backed job queue and worker pool. The stop hook posts diffs to the daemon instead of running reviews inline. Workers claim jobs, spawn AI agents, and store results. The hook client polls for completion.

Daemon configuration in `.mesa/config.yaml`:

```yaml
daemon:
  workers: 2           # Concurrent review workers
  idle_timeout: 1800   # Seconds before auto-shutdown
```

## Rules

Rules live in `.mesa/rules/` as markdown files with YAML frontmatter. Each rule defines what to check, which files it applies to, and how severe a violation is.

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

Mesa reviews any text file — rules are language-agnostic. The import graph supports TypeScript, JavaScript, Python, Go, Rust, Java, and Kotlin.

For a deep dive on writing effective rules, see [Writing Rules](plans/writing-rules.md).

## CLI Reference

| Command | Description |
|---------|-------------|
| `mesa init` | Set up Mesa in your repo (config, rules, hooks, integrations) |
| `mesa review` | Review code changes against your rules |
| `mesa rules generate` | Auto-generate rules by analyzing your codebase |
| `mesa rules create [dir]` | Create a new rule with AI assistance, scoped to a directory |
| `mesa rules list` | List all rules with IDs, titles, and severity |
| `mesa rules explain <id>` | Show full details for a rule |
| `mesa rules validate` | Check all rule files for correct structure |
| `mesa rules for <paths>` | Show which rules match given files/directories |
| `mesa rules delete <id>` | Delete a rule |
| `mesa rules locate` | Print the path to the rules directory |
| `mesa rules sync` | Regenerate `.claude/skills/` from rules |
| `mesa index` | Build the import graph for richer review context |
| `mesa hook install` | Enable automatic reviews in Claude Code |
| `mesa hook uninstall` | Disable automatic reviews |
| `mesa daemon start` | Start the background review daemon |
| `mesa daemon stop` | Stop the background review daemon |
| `mesa model` | Switch AI provider and model interactively |
| `mesa stats` | Show review history and cost analytics |

### `mesa review` Options

```
-b, --base     Base branch to diff against                [default: "main"]
    --head     Head ref to review                         [default: "HEAD"]
-o, --output   Output format: console, json               [default: "console"]
-v, --verbose  Show detailed progress                     [default: false]
    --debug    Write debug logs to .mesa/.tmp/            [default: false]
-c, --config   Path to config file                        [default: ".mesa/config.yaml"]
    --rules    Path to rules directory                    [default: ".mesa/rules/"]
```

### `mesa rules create` Options

```
mesa rules create [target]

    target         Directory the rule targets (e.g. src/api)
    --intent       What the rule should enforce
    --severity     error, warning, or info
    --title        Rule title (auto-generated if omitted)
    --skip-preview Skip the file-match preview step
```

## Configuration

`.mesa/config.yaml` is created by `mesa init`:

```yaml
# AI model for reviews
model:
  provider: anthropic       # anthropic | openai | google
  name: claude-opus-4-6

# Output settings
output:
  cursor_deeplink: true      # Print Cursor IDE links for violations

# Review tuning
review:
  max_steps: 10              # Max tool-calling steps per review batch
  files_per_batch: 2         # Files reviewed together per batch

# Claude Code stop hook
hook:
  enabled: true              # Auto-review when Claude Code finishes writing

# Background daemon
daemon:
  workers: 2                 # Concurrent review workers
  idle_timeout: 1800         # Seconds before auto-shutdown

# Import graph indexing (richer cross-file context)
# index:
#   enabled: true
#   blast_radius_depth: 2
#   context_token_budget: 4000
```

API keys are loaded from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) or from `.env.local` / `.env` files.

### Pre-push Hook

```bash
#!/bin/bash
# .git/hooks/pre-push
mesa review --base origin/main
```

## FAQ

**How is this different from CodeRabbit / Greptile / etc?**

Those tools are AI reviewers that comment on your PRs. Mesa is a rules engine. You define what matters to your team, Mesa enforces it during development — not after the code is already in a PR. No noise, no generic suggestions. If nothing is violated, you hear nothing.

**How much does it cost?**

You use your own API key. Cost depends on your model choice, codebase size, number of rules, and how often you run reviews. `mesa stats` shows your usage history.

**Can I use it without Claude Code?**

Yes. The CLI works standalone. Run `mesa review` from any terminal or CI pipeline. The Claude Code integration (hooks, MCP, slash commands) is optional.

**Where does my data go?**

Nowhere. Mesa runs locally. Your code is sent to the AI provider you configure (Anthropic, OpenAI, Google) for review. Nothing touches Mesa's servers.

**What languages are supported?**

Mesa reviews any text file — rules are language-agnostic. The import graph supports TypeScript, JavaScript, Python, Go, Rust, Java, and Kotlin.

**Can I use it in CI?**

Yes. `mesa review --base origin/main` exits 1 if violations are found. Use `--output json` for structured output.

**What AI providers are supported?**

Anthropic (Claude), OpenAI (GPT-4o, o3), and Google (Gemini).

**What's the background daemon?**

An optional async review system for long-running agent sessions. Reviews run in parallel without blocking your agent. See [Background Daemon](#background-daemon).

## License

Apache-2.0.
