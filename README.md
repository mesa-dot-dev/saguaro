# Mesa Code Review CLI

AI code reviewers leave comments on your PR after the agent that wrote the code is gone. You end up as the middleman between two AIs that never met each other.

Mesa takes a different approach. You define your team's rules as markdown files in your repo. Mesa runs those rules **during development** — inside your coding agent's session, while it still has full context. If the agent violates a rule, it fixes it immediately. By the time you look at the diff, the problem is already gone.

No PR comments. No noise. Silent unless something breaks a rule. You bring your own API key.

<!-- Read the full story: https://mesa.dev/blog/code-review-built-for-slower-world -->

## Install

```bash
brew install mesa-dot-dev/homebrew-tap/code-review
```

Requires an Anthropic API key. Set `ANTHROPIC_API_KEY` in your environment, or paste it during `mesa init`.

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
- Sets up Claude Code integration automatically (MCP server, stop hook, slash commands)
- Stores your API key in `.env.local` if provided

## How It Works

```
Your rules (.mesa/rules/*.md)
     +
Git diff (base..HEAD)
     +
Codebase context (import graph, blast radius)
     ↓
AI checks each changed file against matching rules
     ↓
Violations found -> prints them, exits 1
Nothing found -> silence, exits 0
```

1. Mesa loads your rules from `.mesa/rules/`
2. It diffs your current branch against the base (default: `main`)
3. For each changed file, it finds rules whose globs match
4. It builds codebase context — an import graph showing the "blast radius" (files that import from your changes and files your changes depend on)
5. An AI agent reviews each file against the matched rules, with the diff and context
6. If a rule is violated, Mesa prints the violation. If nothing is wrong, Mesa says nothing.

## Claude Code Integration

`mesa init` sets up three things for Claude Code automatically:

### Stop Hook (automatic review)

Every time Claude Code finishes writing code, Mesa reviews the uncommitted changes. If violations are found, Claude is blocked and asked to fix them before completing.

```bash
mesa hook install    # Enable (done by mesa init)
mesa hook uninstall  # Disable
```

### MCP Server

Mesa registers as an MCP server via `.mcp.json`. Claude Code discovers it on startup and gains access to Mesa's tools (review, create rules, generate rules, etc.).

### Slash Commands

Available inside Claude Code after `mesa init`:

| Command | What it does |
|---------|-------------|
| `/mesa-review` | Run a code review manually |
| `/mesa-createrule` | Create a new rule with AI assistance |
| `/mesa-generaterules` | Auto-generate rules from your codebase |

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

The markdown body contains the instructions the AI uses to evaluate the rule, plus optional `### Violations` and `### Compliant` sections with code examples.

For a deep dive on writing effective rules, see [Writing Rules](plans/writing-rules.md).

## CLI Reference

| Command | Description |
|---------|-------------|
| `mesa init` | Set up Mesa in your repo (config, rules, hooks, Claude Code integration) |
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

`.mesa/config.yaml` is created by `mesa init`. Here's the full reference:

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
  max_steps: 50              # Max tool-calling steps per review batch
  files_per_batch: 2         # Files reviewed together per batch

# Claude Code stop hook
hook:
  enabled: true              # Auto-review when Claude Code finishes writing

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

Those tools are AI reviewers that comment on your PRs. Mesa is a rules engine. You define what matters to your team, Mesa enforces it. No noise, no generic suggestions, no "consider adding a docstring" comments. If nothing is violated, you hear nothing.

**How is this different from Mesa's hosted code review?**

Mesa's hosted review at [mesa.dev/features/code-review](https://www.mesa.dev/features/code-review) is a traditional AI reviewer that comments on PRs. This CLI is a complementary tool — it enforces your team's specific rules locally during development, before code ever reaches a PR.

**How much does it cost?**

You use your own API key. Cost depends on your model choice, codebase size, number of rules, and how often you run reviews. `mesa stats` shows your usage history.

**Can I use it without Claude Code?**

Yes. The CLI works standalone. Run `mesa review` from any terminal or CI pipeline. The Claude Code integration (hook, MCP, slash commands) is optional.

**Where does my data go?**

Nowhere. Mesa runs locally. Your code is sent to the AI provider you configure (Anthropic, OpenAI, Google) for review. Review history is stored locally in `.mesa/history/reviews.jsonl`.

## License

Apache-2.0.
