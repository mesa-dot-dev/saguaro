# Saguaro Code Review

## Architecture Design Document

**Version:** 6.0
**Date:** March 6, 2026

---

## Table of Contents

1. [Vision & Philosophy](#vision--philosophy)
2. [Core Principles](#core-principles)
3. [System Architecture](#system-architecture)
4. [Package Structure](#package-structure)
5. [Adapter Layer](#adapter-layer)
6. [Rules System](#rules-system)
7. [Rule Generation](#rule-generation)
8. [MCP Server](#mcp-server)
9. [Claude Code Hooks](#claude-code-hooks)
10. [Background Review Daemon](#background-review-daemon)
11. [Data Flow](#data-flow)
12. [Agent Design](#agent-design)
13. [Codebase Indexing](#codebase-indexing)
14. [Output Model](#output-model)
15. [Key Interfaces](#key-interfaces)
16. [Configuration](#configuration)
17. [Dependencies](#dependencies)

---

## Vision & Philosophy

> An AI code review tool that **only speaks when something is wrong**, enforces **user-defined rules stored in code**, runs **locally as a CLI**, and uses a **codebase-aware agent** with import graph analysis for surgical context.

### The Problem with Existing Tools

1. **Too chatty** - Comment on everything, including sequence diagrams for button color changes
2. **Assume what to review** - Built-in "default" checks that can't be disabled
3. **Rules as afterthought** - Custom rules are a side feature, not the core
4. **Rules not in code** - Rules stored in cloud dashboards, not version-controlled
5. **Diff-only context** - Only see the diff, missing critical codebase context
6. **Not locally runnable** - Can't run in CI or integrate with local dev tools

### Our Solution

- **Silence is success** - No output unless a rule is violated
- **Rules are the product** - User-defined markdown rules are the core primitive
- **Codebase-aware** - Import graph, importer blast radius, and navigation context
- **Local-first** - CLI tool with user-provided API keys
- **Multi-provider** - Anthropic, OpenAI, Google via Vercel AI SDK

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Silence by default** | No output unless rule violation found |
| **No default checks** | Zero built-in rules; user defines everything |
| **Rules in code** | `.saguaro/rules/` directory in repo, versioned via git |
| **Local-first** | CLI tool; user provides own API keys |
| **Codebase-aware** | Import graph analysis + importer blast radius for navigation context |
| **Parallel execution** | Workers split files for concurrent LLM calls |
| **Graceful degradation** | Indexing failures never block reviews |
| **Layered architecture** | CLI → adapter → domain modules separation of concerns |

---

## System Architecture

The system has three entry points — **CLI**, **MCP server**, and **Background Daemon** — that serve different purposes. The CLI and MCP server share the same adapter layer, generator pipeline, and core engine. The daemon is an independent system that shells out to an installed agent CLI (claude, codex, gemini, etc.) for full code review — it does **not** share the adapter/core code path.

```
+-----------------------------------------------------------------------+
|                      SAGUARO CODE REVIEW                              |
+-----------------------------------------------------------------------+
|                                                                       |
|  +---------------------+   +----------------------+                   |
|  |    CLI (yargs)       |   |  MCP SERVER (stdio)  |                  |
|  |  sag review          |   |  saguaro_review      |                  |
|  |  sag rules *         |   |  saguaro_generate_*  |                  |
|  |  sag daemon *        |   |  saguaro_create_rule |                  |
|  |  sag init | index    |   |  saguaro_sync_rules  |                  |
|  +----------+-----------+   +----------+-----------+                  |
|             |                          |                              |
|             +----------+---------------+                              |
|             |          |                                              |
|             v          v                                              |
|  +-------------------+   +----------------------------------------+   |
|  |  ADAPTER LAYER    |   |  BACKGROUND REVIEW DAEMON              |   |
|  |  review / rules   |   |  (independent — no API key needed)     |   |
|  +--------+----------+   |                                        |   |
|           |               |  HTTP server → SQLite → Worker pool   |   |
|           v               |  Spawns: claude -p / codex / gemini   |   |
|  +-------------------+   |  Read-only tools, diff-hash dedup      |   |
|  | DOMAIN MODULES    |   +----------------------------------------+   |
|  | + GENERATOR        |                                               |
|  +--------+----------+                                                |
|           |                                                           |
|           v                                                           |
|  +-------------------+                                                |
|  | AGENT (Vercel AI) |                                                |
|  | Parallel workers  |                                                |
|  | generateText()    |                                                |
|  +-------------------+                                                |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Two Independent Systems

The rules engine and background daemon share the CLI entry point but **never share a code path at runtime**. The gate is a single early-return in `runHook()`:

```typescript
if (config.daemon?.enabled) {
  // daemon path — HTTP client talks to daemon process
  return postReviewToDaemon(...);
}

// rules engine path — adapter → core → Vercel AI SDK
return runReview(...);
```

| Aspect | Rules Engine | Background Daemon |
|--------|-------------|-------------------|
| **Runtime** | In-process (same CLI) | Separate HTTP server process |
| **AI provider** | Vercel AI SDK (API key required) | Agent CLI subscription (no API key) |
| **Review style** | Injects matched rules as context | Full code review by staff-engineer prompt |
| **Hook behavior** | Synchronous, blocks on violations | Async: queues job, polls for findings |
| **Persistence** | `.saguaro/history/reviews.jsonl` | SQLite (`~/.saguaro/reviews.db`) |
| **Finding delivery** | Exit code 2 + stderr (blocking) | Soft guidance (non-blocking recommendations) |

---

## Package Structure

Package: `@mesadev/saguaro`

```
src/
├── adapter/                        # Boundary between CLI/MCP and domain modules
│   ├── agents/                    # Agent-specific integration adapters
│   │   ├── claude.ts             # Claude Code hooks, skills, settings
│   │   ├── codex.ts              # Codex adapter
│   │   ├── gemini.ts             # Gemini adapter
│   │   ├── registry.ts           # Agent detection + priority ordering
│   │   ├── types.ts              # AgentAdapter interface
│   │   └── utils.ts              # Shared agent utilities
│   ├── classic-review.ts          # Classic (non-rules) review mode
│   ├── generate.ts                # Generate adapter
│   ├── hook.ts                    # Hook install/uninstall (settings file management)
│   ├── hook-runner.ts             # Stop hook review logic: uncommitted changes, block/allow decision
│   ├── index-build.ts             # Index build adapter
│   ├── init.ts                    # Project initialization adapter
│   ├── model.ts                   # Model selection adapter
│   ├── review.ts                  # Review adapter: wires runtime to core engine
│   ├── rules.ts                   # Rules adapter: createRule, listRules, writeGeneratedRules, etc.
│   ├── stats.ts                   # Stats adapter
│   └── transcript.ts              # Hook transcript formatting
│
├── ai/                             # AI execution layer (Vercel AI SDK + CLI agents)
│   ├── agent-runner.ts            # CLI agent detection and invocation (claude, codex, gemini)
│   ├── cli-reviewer.ts            # Review via CLI agent (claude -p, codex, gemini)
│   ├── parser.ts                  # Violation parsing and deduplication
│   ├── prompt.ts                  # System prompt and prompt construction
│   ├── runtime.ts                 # Review runtime: routes to SDK or CLI reviewer
│   └── sdk-reviewer.ts            # Review via Vercel AI SDK (generateText + workers)
│
├── cli/                            # CLI layer (yargs commands + TUI launcher)
│   ├── bin.tsx                    # Entry point — runs CLI, falls back to TUI
│   ├── commands/
│   │   ├── index.ts              # Yargs command router
│   │   ├── daemon.ts             # sag daemon start/stop/status
│   │   └── review.ts             # sag review command
│   └── lib/
│       ├── daemon.ts              # Daemon start/stop handlers
│       ├── generate.ts            # sag rules generate — bulk rule generation + interactive review
│       ├── hook.ts                # sag hook run/pre-tool (CLI wrappers)
│       ├── index-cmd.ts           # sag index
│       ├── init.ts                # sag init (interactive setup)
│       ├── model.ts               # sag model
│       ├── prompt.ts              # Readline helpers: ask(), askChoice(), createReadline()
│       ├── rules.ts               # sag rules (list, create, delete, explain, validate, for, sync, locate)
│       ├── serve.ts               # sag serve — starts MCP server in stdio mode
│       ├── spinner.ts             # TTY-aware progress spinner
│       └── stats.ts               # sag stats
│
├── config/                         # Configuration and model resolution
│   ├── catalog.ts                 # Model catalog: live provider/model fetching
│   ├── config-template.ts         # Default config YAML template
│   ├── env.ts                     # API key checking, env file helpers
│   └── model-config.ts            # .saguaro/config.yaml loading, Zod schema, model resolution
│
├── core/                           # Pure business logic, injected deps only
│   ├── review.ts                  # createReviewCore() — pure review engine
│   └── types.ts                   # Core type definitions
│
├── daemon/                         # Background review daemon (independent system)
│   ├── server.ts                  # HTTP server + daemon lifecycle (SaguaroDaemon class)
│   ├── store.ts                   # SQLite database: review_jobs + reviews tables
│   ├── worker.ts                  # Review job worker: claims jobs, runs agent, parses findings
│   ├── agent-cli.ts               # Agent detection + invocation (claude, codex, gemini, etc.)
│   ├── hook-client.ts             # HTTP client for daemon communication from stop hook
│   ├── prompt.ts                  # Staff-engineer review prompt construction
│   ├── db.ts                      # Database adapter (bun:sqlite or better-sqlite3)
│   ├── ARCHITECTURE.md            # Daemon-specific architecture documentation
│   └── __tests__/                 # Integration tests
│
├── generator/                      # Bulk rule generation pipeline
│   ├── index.ts                   # Public entry: generateRules()
│   ├── orchestrator.ts            # Multi-stage pipeline: scan → zone analysis → synthesis
│   ├── scanner.ts                 # Codebase scanning: zone discovery, file selection
│   ├── architecture.ts            # Compute architectural context from import graph
│   ├── synthesis.ts               # LLM-powered dedup/merge of candidate rules
│   ├── schemas.ts                 # Zod schemas for generator
│   └── types.ts                   # RuleProposalSchema, ZoneConfig, GeneratorResult, etc.
│
├── git/                            # Git operations
│   └── git.ts                     # git diff, changed files, repo root, branch detection
│
├── indexer/                        # Codebase indexing + import graph
│   ├── build.ts                   # File discovery + incremental index building
│   ├── index.ts                   # Context builder (symbol filtering, token budget)
│   ├── constants.ts               # Indexer constants and limits
│   ├── resolver.ts                # oxc-resolver wrapper for module resolution
│   ├── store.ts                   # JSON persistence + blast radius BFS
│   ├── types.ts                   # CodebaseIndex, FileEntry, ImportRef, ExportRef
│   ├── README.md                  # Indexer-specific documentation
│   └── parsers/
│       ├── index.ts               # Parser dispatch + file support check
│       ├── swc-parser.ts          # SWC-based TS/JS/TSX/JSX parser
│       └── tree-sitter/           # Multi-language parsing
│           ├── init.ts            # Tree-sitter WASM initialization
│           ├── parser.ts          # Generic tree-sitter parser
│           ├── common.ts          # Shared tree-sitter types + helpers
│           └── languages/         # Language-specific extractors
│               ├── go.ts
│               ├── java.ts
│               ├── kotlin.ts
│               ├── python.ts
│               └── rust.ts
│
├── mcp/                            # MCP server for AI agent integration
│   ├── config.ts                  # MCP JSON config generation
│   ├── server.ts                  # Tool registration (McpServer + zod schemas)
│   └── tools/
│       └── handler.ts             # Tool handlers, session state for generate → write flow
│
├── rules/                          # Rule loading, resolution, generation, and analysis
│   ├── detect-ecosystems.ts       # Detect project ecosystems (react, python, go, etc.)
│   ├── generator.ts               # LLM-powered single rule generation from target analysis
│   ├── saguaro-rules.ts           # Load + parse .saguaro/rules/*.md (frontmatter + body)
│   ├── preview.ts                 # Dry-run rules against target files
│   ├── resolution.ts              # Rule loading, glob matching, priority sorting, repo root
│   ├── scope-discovery.ts         # Discover package boundaries for rule generation
│   ├── starter.ts                 # Starter rule selection by ecosystem
│   ├── target-analysis.ts         # Analyze target: file sampling, globs, placements
│   └── target-resolver.ts         # Smart text input: path/keyword → resolved target
│
├── stats/                          # Review history and analytics
│   ├── aggregate.ts               # Stats aggregation from review history
│   └── history.ts                 # Review history persistence (JSONL)
│
├── templates/                      # Built-in starter content + MCP skill definitions
│   ├── ecosystems.ts              # Ecosystem registry for init display
│   ├── starter-rules.ts           # 25 curated starter rule policies (few-shot examples)
│   └── mcp-skills.ts              # MCP workflow skill definitions (review, create, generate)
│
├── tui/                            # Interactive terminal UI (React + OpenTUI)
│   ├── app.tsx                    # Root TUI application component
│   ├── index.tsx                  # TUI launcher (createCliRenderer)
│   ├── components/                # Reusable UI components (input bar, spinner)
│   ├── lib/                       # Router, theme, commands, exit handling
│   └── screens/                   # TUI screens (home, review, rules, stats, etc.)
│
├── types/
│   └── types.ts                   # Rule, Violation, ReviewResult, Severity, RulePolicy
│
├── util/                           # Shared utilities
│   ├── constants.ts               # IGNORED_DIRS, PACKAGE_MARKERS, CodebaseSnippet, toKebabCase
│   ├── errors.ts                  # Custom error types (SaguaroError, SaguaroErrorCode)
│   ├── logger.ts                  # Debug logging
│   └── review-utils.ts            # Shared review helpers
│
└── index.ts                        # Public exports (programmatic API)
```

---

## Adapter Layer

The adapter layer (`src/adapter/`) provides a clean boundary between the entry points (CLI and MCP) and the domain modules (`ai/`, `config/`, `git/`, `rules/`, `stats/`). Neither CLI nor MCP handler code should import directly from domain modules — they go through adapters.

```
CLI (generate.ts, rules.ts, review.ts)       MCP (handler.ts)
    |                                              |
    +------------------+---------------------------+
                       |
                       v
              ADAPTER LAYER
              +-- adapter/review.ts    — runReview()
              +-- adapter/rules.ts     — createRuleAdapter(), listRulesAdapter(), writeGeneratedRules(), etc.
                       |
                       v
              DOMAIN MODULES + GENERATOR
```

### Agent Adapters (`adapter/agents/`)

The `AgentAdapter` interface abstracts agent-specific integrations (hooks, skills, settings directories). Each adapter (Claude, Codex, Gemini) implements:

- `installHooks()` / `uninstallHooks()` — agent-specific hook configuration
- `writeSkills()` — write skill files to the agent's skills directory
- `settingsDir` / `skillsDir` — paths to agent configuration

The registry (`registry.ts`) detects installed agents and orders them by priority (Claude > Codex > Gemini).

### Review Adapter (`adapter/review.ts`)

Wires the Node.js runtime (file I/O, git, rule loading) to the pure review core engine. Used identically by both `sag review` CLI command and `saguaro_review` MCP tool.

### Rules Adapter (`adapter/rules.ts`)

Provides a unified interface for all rule operations. Returns `RulePolicy` directly (no wrapper types):

- `createRuleAdapter(opts)` — Creates a `.md` rule file in `.saguaro/rules/` with YAML frontmatter
- `writeGeneratedRules(rules)` — Batch write for bulk-generated rules. Calls `createRuleAdapter()` for each rule. Passes through examples and tags.
- `generateRuleAdapter(request)` — Orchestrates single-rule generation (analyze target → LLM → preview)
- `listRulesAdapter()` — Lists all rules from `.saguaro/rules/` via `loadSaguaroRules()`
- `explainRuleAdapter(id)` — Returns full details for a single rule
- `deleteRuleAdapter(id)` — Removes a rule file
- `validateRulesAdapter()` — Validates rule structure and frontmatter

---

## Rules System

Rules are stored as **markdown files** in `.saguaro/rules/` at the repo root, with YAML frontmatter containing all metadata.

### Directory Structure

```
.saguaro/rules/
├── no-wall-clock.md
├── no-console-log.md
└── guard-percentage-division.md
```

### Rule File Format

Rules use markdown with YAML frontmatter:

````markdown
---
id: no-wall-clock
title: Ban direct wall clock access
severity: error
globs:
  - "**/*.rs"
  - "!**/tests/**"
tags:
  - correctness
  - time
---

Use a Clock trait instead of calling Utc::now() directly.

## What to Look For

- `Utc::now()` — Direct wall-clock access
- `SystemTime::now()` — Direct system time access

## Why This Matters

- Direct time access makes tests non-deterministic
- Clock injection enables time travel in tests

## Correct Patterns

```rust
// Good: Injected clock dependency
clock.now()
```

### Violations

```
Utc::now()
```

```
SystemTime::now()
```

### Compliant

```
clock.now()
```
````

### Agent Discovery via SKILL.md

A single `.claude/skills/saguaro-rules/SKILL.md` at the repo root instructs AI agents to run the CLI for rule discovery. This file is automatically synced by `sag rules sync` (and during `sag init`):

```markdown
---
name: saguaro-rules
description: >
  REQUIRED before ANY file edit or creation. Run sag rules for <paths>
  to load applicable code review rules.
---

Before editing or creating any files, determine which files and
directories you plan to touch, then run:

    sag rules for <path1> <path2> ...
```

#### Why a single dispatch skill

Claude Code's native skill discovery traverses the directory tree and loads skills from `.claude/` directories at each level. The natural approach would be to place per-rule skills in each relevant directory so Claude automatically discovers only the rules that apply to its working area. However, this litters the codebase with `.claude/` directories and skill artifacts throughout the repo, which developers don't want checked in alongside their code.

Instead, we use one skill at the root that calls `sag rules for <paths>`. When Claude knows what directory it's about to work in, it runs this command, which loads all rules from `.saguaro/rules/`, matches their globs against the given paths, and returns only the applicable rules. This emulates native per-directory skill discovery without the file system pollution.

This also eliminates duplication — previously each rule required both a `.saguaro/rules/` markdown file and a corresponding `.claude/skills/` directory. Now rules live in one place and the single skill handles discovery dynamically.

#### Why CLI over MCP for rule discovery

- **Zero overhead** — CLI has no server startup cost (MCP takes ~3s)
- **Text output is ideal** — Rules are returned as text that agents consume directly
- **Reliable** — Shell commands from SKILL.md are deterministically followed
- **No flags** — `sag rules for <paths>` is a proper subcommand, not a flag. Claude Code invokes skills by name and passes arguments, but cannot invoke CLI flags from skill calls.

### Starter Rules

`sag init` can optionally install starter rules into `.saguaro/rules/`. These are defined in `src/templates/starter-rules.ts`. The starter rules also serve as few-shot examples for the LLM during rule generation.

### Rule Loading at Review Time

1. Load all `.md` files from `.saguaro/rules/` at repo root
2. Parse YAML frontmatter for globs, severity, instructions
3. Deterministic `minimatch` glob matching — no AI for rule selection
4. Negation patterns (`!**/tests/**`) supported for excluding files
5. Rules sorted by descending `priority` (default 0), then alphabetically by `id`

---

## Rule Generation

There are two rule generation pipelines, both available through CLI and MCP. They share the same adapter layer and write path but differ in how rules are discovered.

### Few-Shot Examples (Shared)

Both pipelines use **starter rules** (`src/templates/starter-rules.ts`) as few-shot examples to teach the LLM the expected output format. These are 25 curated `RulePolicy` objects with full `instructions`, `examples` (violations + compliant snippets), and `tags`. The LLM sees them as YAML reference examples in the prompt and learns the structure, example quality bar, and instruction format.

### Pipeline 1: Single Rule Creation (`sag rules create` / `saguaro_generate_rule`)

Generates one rule from a user's intent and a target directory.

```
User provides: target directory + intent
         |
         v
+--------------------------------------------------+
|  1. TARGET ANALYSIS                               |
|     analyzeTarget({ targetPath, repoRoot })       |
|     - Sample files, build tree, detect languages  |
|     - Generate suggested globs                    |
|     - Compute placement options                   |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  2. FEW-SHOT SELECTION                            |
|     selectFewShotExamples(intent)                 |
|     - Keyword match intent against starter rules  |
|     - Pick 2-3 most relevant as YAML references   |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  3. RULE GENERATION (LLM)                         |
|     generateText() → structured YAML policy       |
|     - Includes target files, boundary context     |
|     - Includes few-shot reference examples        |
|     - Parse + validate against RulePolicySchema    |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  4. PREVIEW + APPROVAL + WRITE                    |
|     previewRule() → createRuleAdapter()             |
+--------------------------------------------------+
```

| Module | Responsibility |
|--------|---------------|
| `rules/generator.ts` | LLM generation with few-shot examples, prompt building, YAML parsing |
| `rules/target-analysis.ts` | Analyze target directory: file sampling, globs, placements |
| `rules/preview.ts` | Substring-match violation patterns against target files |
| `rules/scope-discovery.ts` | Discover package boundaries for rule scoping |

### Pipeline 2: Bulk Rule Generation (`sag rules generate` / `saguaro_generate_rules`)

Discovers rules across the entire codebase automatically.

```
+--------------------------------------------------+
|  1. INDEXING                                      |
|     buildIndex() — import graph for file ranking  |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  2. SCANNING                                      |
|     scanAndSelectFiles()                          |
|     - Divide codebase into zones (packages/dirs)  |
|     - Select representative files per zone        |
|     - Rank by import count (hub files first)      |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  3. ZONE ANALYSIS (parallel)                      |
|     For each zone, generateObject():              |
|     - System: ZONE_ANALYSIS_SYSTEM prompt         |
|     - User: zone files + configs + architecture   |
|           + few-shot starter rules as YAML refs   |
|     - Schema: RuleProposalSchema (with examples)  |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  4. DETERMINISTIC MERGE                           |
|     deterministicMerge()                          |
|     - Remove unscoped globs (**/*.ts)             |
|     - Remove vague instructions (< 80 chars)      |
|     - Remove test-only rules                      |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  5. SYNTHESIS (LLM)                               |
|     synthesizeRules()                             |
|     - Merge overlapping candidates                |
|     - Remove kitchen-sink / generic rules         |
|     - Preserve examples across merges             |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  6. REVIEW + WRITE                                |
|     CLI: interactive Y/N/E per rule               |
|     MCP: session state → saguaro_write_accepted_rules|
|     Both: writeGeneratedRules() → adapter         |
+--------------------------------------------------+
```

| Module | Responsibility |
|--------|---------------|
| `generator/orchestrator.ts` | Full pipeline orchestration, zone analysis with few-shot injection |
| `generator/scanner.ts` | Codebase scanning, zone discovery, file selection + ranking |
| `generator/synthesis.ts` | LLM-powered dedup/merge of candidate rules |
| `generator/architecture.ts` | Compute architectural context from import graph |
| `generator/types.ts` | `RuleProposalSchema` (Zod), zone/result types |

### Shared Write Path

Both pipelines converge at the same write path:

```
RulePolicy[]
    |
    +---> writeGeneratedRules() / createRuleAdapter()
              |
              +-- Write .saguaro/rules/<id>.md    — YAML frontmatter + instructions + examples
```

---

## MCP Server

The MCP server (`src/mcp/`) exposes Saguaro's capabilities to AI agents (Claude Code, etc.) over the Model Context Protocol via stdio transport. It provides the same operations as the CLI through MCP tools, sharing the adapter layer.

### Tools

| Tool | Purpose | Maps to |
|------|---------|---------|
| `saguaro_review` | Run code review | `adapter/review.runReview()` |
| `saguaro_generate_rules` | Bulk rule generation | `generator/generateRules()` |
| `saguaro_generate_rule` | Single rule generation | `adapter/rules.generateRuleAdapter()` |
| `saguaro_create_rule` | Manual rule creation | `adapter/rules.createRuleAdapter()` |
| `saguaro_write_accepted_rules` | Persist generated rules | `adapter/rules.writeGeneratedRules()` |
| `saguaro_list_rules` | List rules | `adapter/rules.listRulesAdapter()` |
| `saguaro_explain_rule` | Show rule details | `adapter/rules.explainRuleAdapter()` |
| `saguaro_delete_rule` | Delete a rule | `adapter/rules.deleteRuleAdapter()` |
| `saguaro_validate_rules` | Validate rule structure | `adapter/rules.validateRulesAdapter()` |
| `saguaro_sync_rules` | Regenerate agent skills from rules | `adapter/rules.syncSkillsFromRules()` |

### Session State

The MCP handler maintains a module-level `lastGeneratedRules: RulePolicy[]` that survives across tool calls within a session. This enables a two-phase generate → write flow:

1. `saguaro_generate_rules` runs the pipeline, stores full `RulePolicy[]` in session state, and returns the generated rules to the client.

2. The client reviews the rules and decides which to accept.

3. The client calls `saguaro_write_accepted_rules(rule_ids)` to persist accepted rules. This filters from session state and writes via `writeGeneratedRules()`.

### MCP Skill Definitions

The MCP server installs workflow skill files (`src/templates/mcp-skills.ts`) into agent skills directories during `sag init`. These guide AI agents through the correct tool-call sequences:

- `saguaro-review/SKILL.md` — Review workflow
- `saguaro-createrule/SKILL.md` — Single rule generation workflow
- `saguaro-generaterules/SKILL.md` — Bulk generation workflow (accept all / bulk review / individual review / skip all → `saguaro_write_accepted_rules`)

Additionally, `sag rules sync` installs the rule-discovery skill:

- `saguaro-rules/SKILL.md` — Instructs agents to run `sag rules for <paths>` before editing files

---

## Claude Code Hooks

Saguaro installs two **Claude Code hooks** that integrate reviews into the coding workflow.

### PreToolUse Hook

Fires before `Edit` and `Write` tool calls. Injects relevant rules so Claude knows your team's conventions before writing code.

### Stop Hook

Fires when Claude finishes a turn. Reviews uncommitted changes against the base branch and blocks Claude if violations are found, asking it to fix them before completing.

### Why a Stop Hook

The Stop hook is the only Claude Code hook type that fires after every file write. Other hook types are conditional and would miss edits or file creations. The goal is fast, continuous review as Claude works — not a slow review after a batch of changes. The review pipeline skips files that don't match any rule globs, so editing a markdown file in a repo with only `**/*.ts` rules burns zero tokens.

### Why Not MCP

An MCP-based approach (having Claude call `saguaro_review` after each turn) was considered but rejected:

- **Requires user approval** — MCP tool calls prompt the user with "do you want to run this?", adding friction to every turn
- **Extra server process** — MCP adds another long-running server on the developer's machine
- **Harder to debug** — Hook failures surface directly in the terminal; MCP failures are buried in server logs

The Stop hook runs as a fast CLI command, requires no user interaction, and produces output inline.

### How It Works

```
Claude Code finishes a turn (file edit / creation)
        |
        v
+---------------------------------------------------------------+
|  1. LOOP PREVENTION                                           |
|                                                               |
|     Check stdin for stop_hook_active flag.                    |
|     If Claude is already fixing violations from a previous    |
|     hook run, exit 0 immediately to avoid infinite loops.     |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  2. COLLECT UNCOMMITTED CHANGES                               |
|                                                               |
|     listLocalChangedFilesFromGit()  — staged + unstaged       |
|     listUntrackedFiles()            — new files               |
|     Merge into a single set of changed files.                 |
|     If no changes, exit 0 (allow).                            |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  3. REVIEW                                                    |
|                                                               |
|     Run the standard review pipeline against uncommitted      |
|     changes only (not committed history). Uses the same       |
|     runReview() adapter as the CLI and MCP.                   |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  4. DECISION                                                  |
|                                                               |
|     No violations  → exit 0 (allow, Claude continues)         |
|     Violations     → exit 2 (block, violations sent to        |
|                      stderr as structured feedback for         |
|                      Claude to fix before completing)          |
+---------------------------------------------------------------+
```

### Installation

The hook is installed automatically during `sag init`. It writes hook entries to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "sag hook pre-tool"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "sag hook run",
        "timeout": 120,
        "statusMessage": "Running Saguaro code review..."
      }]
    }]
  }
}
```

| Command | Purpose |
|---------|---------|
| `sag hook install` | Add hooks to `.claude/settings.json` |
| `sag hook uninstall` | Remove hook entries |
| `sag hook run` | Internal — invoked by the Stop hook, not by users |
| `sag hook pre-tool` | Internal — invoked by the PreToolUse hook, not by users |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Uncommitted changes only** | Reviews changes as they're written. Reviewing committed history would burn tokens redundantly on already-reviewed code. |
| **Loop prevention via `stop_hook_active`** | Proactive guard. When Claude is fixing violations from a previous hook run, the hook exits immediately to prevent an infinite review → fix → review cycle. |
| **Exit code 2 for violations** | Claude Code convention: exit 2 blocks the agent and feeds stderr back as feedback. Claude sees the formatted violations and fixes them before continuing. |

### Daemon Mode in the Stop Hook

When `daemon.enabled: true` in `.saguaro/config.yaml`, the stop hook delegates to the daemon instead of running the rules engine:

1. **Loop prevention** — Same `stop_hook_active` check as rules engine
2. **Ensure daemon is running** — Read `~/.saguaro/daemon.pid`; if stale or missing, auto-start in background
3. **Check for previous findings** — `GET /check?session={id}`, poll up to 30s for results from the previous review
4. **Queue new review** — `POST /review` with session_id, changed_files, diff_hashes (returns immediately)
5. **Decision** — Previous findings exist → exit 2 (block with soft guidance); no findings → exit 0

The key difference: the daemon reviews the **previous** turn's changes while queueing the **current** turn's changes for background processing. The first turn always passes, and findings arrive one turn later as non-blocking soft guidance.

---

## Background Review Daemon

The daemon is a **completely independent system** from the rules engine. It requires no API key — it shells out to an installed agent CLI (claude, codex, gemini, etc.) that uses its own subscription. The daemon performs full code review using a staff-engineer prompt rather than matching user-defined rules.

For detailed architecture, data model, known issues, and future considerations, see [`src/daemon/ARCHITECTURE.md`](../src/daemon/ARCHITECTURE.md).

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **SaguaroDaemon** | `daemon/server.ts` | HTTP server on `127.0.0.1:7474`, endpoint routing, idle timeout, PID/lock file management |
| **DaemonStore** | `daemon/store.ts` | SQLite (`~/.saguaro/reviews.db`): job queue, review storage, diff-hash deduplication |
| **Worker** | `daemon/worker.ts` | Polls queue every 2s, claims FIFO jobs, invokes agent, parses findings |
| **Agent CLI** | `daemon/agent-cli.ts` | Detects installed agent (claude > codex > gemini > opencode > copilot > cursor), read-only tools, 5min timeout |
| **Hook Client** | `daemon/hook-client.ts` | HTTP client for stop hook → daemon communication |

### Key Mechanisms

- **Diff-hash deduplication** — Each file's diff is hashed (`sha256`). Files with unchanged hashes since the last review in the same session are skipped.
- **Atomic job claiming** — Workers claim via `UPDATE ... WHERE id = (SELECT ... WHERE status = 'queued' LIMIT 1) RETURNING *`. SQLite's write lock prevents double-claiming.
- **Agent invocation** — Spawns `claude -p` (or codex, gemini, etc.) with `--allowedTools Read,Glob,Grep` (read-only). Environment stripped of `CLAUDECODE*` vars, `SAGUARO_REVIEW_AGENT=1` set to prevent loops.
- **Soft guidance** — Findings injected as recommendations, not blocking rules.
- **Prompt size limits** — Jobs exceeding 125KB diff+context are skipped.
- **Idle timeout** — Auto-shuts down after 30 minutes of inactivity (configurable).

---

## Data Flow

### Review Flow

```
$ sag review --base main
        |
        v
+---------------------------------------------------------------+
|  1. CONTEXT GATHERING (parallel)                              |
|                                                               |
|     getChangedFiles()          loadRules()                    |
|     git diff --name-only      Load .saguaro/rules/*.md        |
|     --diff-filter=ACMR        Parse YAML frontmatter          |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  2. RULE SELECTION                                            |
|                                                               |
|     selectRulesForFiles(changedFiles, rules)                  |
|     Deterministic minimatch glob matching (no AI)             |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  3. DIFF COMPUTATION                                          |
|                                                               |
|     getDiffs() — single git diff call, parsed by file         |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  4. CODEBASE INDEXING (graceful — never blocks review)        |
|                                                               |
|     buildIndex()       — SWC/tree-sitter parse                |
|     getBlastRadius()   — Importers-only BFS, barrel-aware     |
|     buildContext()     — Lightweight navigation map            |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  5. PARALLEL AGENT EXECUTION                                  |
|                                                               |
|     Split files into batches (configurable files_per_batch)   |
|     For each batch (Promise.all):                             |
|       buildPrompt(codebaseContext + diffs + rules)            |
|       generateText({ model, system, prompt, tools })          |
|       Tool: read_file (cross-file investigation)              |
|       Max steps: configurable via max_steps                   |
|       Collect text from ALL steps                             |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  6. PARSE & OUTPUT                                            |
|                                                               |
|     Regex parse: [rule-id] file:line - description            |
|     Map rule IDs back to metadata (title, severity)           |
|     Format output (console/JSON + optional Cursor deeplink)   |
|                                                               |
|     Exit code: 0 = clean, 1 = violations, 3 = agent error    |
+---------------------------------------------------------------+
```

---

## Agent Design

### Execution Model

Each review spawns parallel workers via the Vercel AI SDK `generateText()`:

1. Files are split into batches (configurable via `review.files_per_batch`, default 2)
2. Each worker gets a separate `generateText()` call with its own prompt
3. Workers run in parallel via `Promise.all()`
4. Each worker has a single tool: `read_file` for cross-file investigation
5. Workers are capped at configurable max steps (`review.max_steps`, default 10)

### System Prompt

The system prompt guides the agent through three phases:

```
## Your Workflow

### Phase 1: Orient
Read the Codebase Map (if provided) to understand which files import
from the changed files.

### Phase 2: Review
For each file and its applicable rules:
- Read the diff carefully, focusing on "+" lines (added code)
- Apply each rule's instructions to the changes
- Use read_file if you need to see surrounding context

### Phase 3: Investigate
If a potential violation needs context from other files:
- Use read_file to check related code (including upstream
  dependencies visible in import statements from the diff)
- Verify the violation before reporting

## Output Format
Report violations as: [rule-id] file:line - description
If no violations: "No violations found"
```

### Tool: `read_file`

The only tool available to the agent:

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Repo-relative file path |

Constraints:
- Path traversal prevention (rejects `..`, absolute paths)
- 10KB file truncation
- Reads relative to repo root

### Violation Reporting

Violations are reported as plain text in the agent's output, then parsed via regex:

```
[no-wall-clock] src/api/handler.rs:47 - Direct call to Utc::now() detected.
Inject a Clock dependency instead.
```

The regex parser extracts `rule_id`, `file`, `line`, and `message`. This approach was deliberately chosen over structured output because:

- Text format is constrained enough that LLMs follow it reliably
- A tool-based approach would add an extra round-trip per violation
- Text output is human-readable in verbose mode
- The regex parser is small and handles edge cases

### Pre-computed Context

All context is injected into the prompt upfront — the agent does not fetch diffs or rules at runtime:

- **Diffs:** Pre-computed via `git diff`, injected per-file (truncated at 30KB)
- **Rules:** Full rule definitions with instructions and examples
- **Codebase context:** Lightweight navigation map from import graph analysis (see below)

---

## Codebase Indexing

### Overview

The indexer builds an import graph of the codebase, computes an importers-only "blast radius" from changed files, and generates a token-budgeted navigation map for the review prompt. This tells the agent which files are connected to the changes — it uses `read_file` to investigate further.

### Supported Languages

| Language | Parser | Status |
|----------|--------|--------|
| TypeScript/TSX | SWC (`@swc/core`) | Full support |
| JavaScript/JSX | SWC (`@swc/core`) | Full support |
| Go | tree-sitter (`web-tree-sitter`) | Implemented |
| Java | tree-sitter (`web-tree-sitter`) | Implemented |
| Kotlin | tree-sitter (`web-tree-sitter`) | Implemented |
| Python | tree-sitter (`web-tree-sitter`) | Implemented |
| Rust | tree-sitter (`web-tree-sitter`) | Implemented |

### Pipeline

```
File Discovery (skip: node_modules, dist, .git, .saguaro, etc.)
        |
        v
Parser Dispatch (SWC for TS/JS, tree-sitter for others)
        |
        v
Extract imports, exports, signatures
        |
        v
oxc-resolver (resolve import specifiers to repo-relative paths)
        |
        v
Reverse Index (importedBy edges)
        |
        v
JSON Persistence (.saguaro/cache/index.json)
        |
        v
Blast Radius BFS (importers-only, barrel-aware, configurable depth)
        |
        v
Lightweight Context Map (exports + importers for changed files, connections for importer files)
```

### Incremental Updates

Files are hashed (SHA-256). On subsequent runs, only changed files are re-parsed. The index is stored at `.saguaro/cache/index.json` (gitignored).

### Blast Radius

Starting from changed files, BFS traverses **importers only** (files that import from a changed file). Upstream dependencies (files that a changed file imports from) are deliberately excluded — import statements are already visible in the diff, and the agent can use `read_file` to inspect upstream files when needed.

Each file in the radius is classified:
- `changed` — directly modified in the diff
- `importer` — imports symbols from a changed file

**Barrel file detection:** Index/barrel files (e.g. `index.ts`, `mod.rs`, `__init__.py`) that primarily re-export (>50% of exports are re-exports) get one extra level of `importedBy` traversal. This ensures the real consumers behind a barrel file are included without increasing the default depth for all files.

Default depth is **1** (configurable via `index.blast_radius_depth` in `.saguaro/config.yaml`).

### Context Format

The context section is a lightweight navigation map — it tells the agent which files are connected, not the full dependency graph. The agent uses `read_file` to investigate further.

For **changed files**, the context shows exports and importers:

```markdown
### src/lib/config.ts (changed)
Exports: loadConfig(): SaguaroConfig, resolveModel(): LanguageModel
Imported by: src/lib/runner.ts, src/cli/review.ts
```

For **importer files**, the context shows which changed files they import from and which symbols they use:

```markdown
### src/lib/runner.ts (imports loadConfig, resolveModel from src/lib/config.ts)
```

Key behaviors:
- **Changed files:** Show non-re-export exports with signatures, plus `importedBy` list
- **Importer files:** Single line showing connected changed files and imported symbols
- **No upstream dependencies:** Import paths are in the diff; the agent uses `read_file` for upstream context
- **Token budget:** Default 4000 tokens (~16KB). Changed files are prioritized over importers. Sections that exceed the budget are skipped.

### Graceful Failure

If indexing fails for any reason, the review continues without codebase context. This is enforced by a try/catch in `getCodebaseContext()` that returns an empty string on error.

---

## Output Model

### Silence is Success

If no rules are violated, output is minimal. Violations are displayed in a styled box:

```
$ sag review --base main

  +-----------------------------------------------------+
  |  Saguaro Code Review Results                         |
  |                                                      |
  |  X src/api/handler.rs:47 [error]                     |
  |    Rule: no-wall-clock                               |
  |    Direct call to Utc::now() detected.               |
  |                                                      |
  |  1 violation (1 error, 0 warnings)                   |
  +-----------------------------------------------------+
```

### Output Formats

| Format | Flag | Use Case |
|--------|------|----------|
| Console | `--output console` (default) | Human-readable terminal output |
| JSON | `--output json` | Machine-readable for CI/CD |

### Cursor Deeplink

When `output.cursor_deeplink: true` in `.saguaro/config.yaml`, the output includes a clickable terminal link that opens Cursor with a pre-filled prompt containing all violations for quick fixing.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No error-severity violations |
| 1 | Error-severity violations found |
| 3 | Agent/runtime error |

---

## Key Interfaces

```typescript
// Severity levels
type Severity = 'error' | 'warning' | 'info';

// Rule policy (from .saguaro/rules/*.md frontmatter + body)
interface RulePolicy {
  id: string;
  title: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  examples?: {
    violations?: string[];
    compliant?: string[];
  };
  tags?: string[];
  priority?: number;
}

// Violation (parsed from agent text output)
interface Violation {
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
}

// Review result
interface ReviewResult {
  violations: Violation[];
  summary: {
    filesReviewed: number;
    rulesChecked: number;
    errors: number;
    warnings: number;
    infos: number;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  };
}

// Review engine outcome (discriminated union)
type ReviewEngineOutcome =
  | { kind: 'no-changed-files'; ... }
  | { kind: 'no-matching-rules'; ... }
  | { kind: 'reviewed'; result: ReviewResult; ... };
```

### Target Analysis Types

```typescript
interface TargetAnalysis {
  resolvedPath: string;       // absolute path to the target
  relativePath: string;       // relative to repo root
  files: CodebaseSnippet[];   // sampled from target dir (up to 5 files, each <=3000 chars)
  boundaryFiles: CodebaseSnippet[]; // sampled from sibling dirs (up to 3 files)
  directoryTree: string;      // ASCII tree of target's parent showing siblings
  suggestedGlobs: string[];   // e.g., ["packages/web/src/**/*.{ts,tsx}", "!**/*.test.*"]
  detectedLanguages: string[];// e.g., ["typescript"]
  placements: PlacementOption[];
}

interface PlacementOption {
  skillsDir: string;          // absolute path where agent skills would go
  label: string;              // human-readable (e.g., "src/cli (collocated with code)")
  reason: string;
  recommended: boolean;
  type: 'collocated' | 'package' | 'root' | 'existing';
}
```

### Codebase Index Types

```typescript
interface CodebaseIndex {
  version: 2;
  rootDir: string;
  indexedAt: string;  // ISO 8601
  files: Record<string, FileEntry>;
}

interface FileEntry {
  contentHash: string;  // SHA-256
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx'
    | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'unknown';
  imports: ImportRef[];
  exports: ExportRef[];
  importedBy: string[];  // reverse index
}

interface ImportRef {
  source: string;           // raw specifier
  resolvedPath?: string;    // repo-relative path (null for external packages)
  symbols: string[];
  typeSymbols: string[];
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';
  isTypeOnly: boolean;
  defaultAlias?: string;
  namespaceAlias?: string;
}

interface ExportRef {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable'
      | 'const' | 're-export' | 're-export-all' | 'unknown';
  signature?: string;
  isDefault?: boolean;
  isTypeOnly?: boolean;
  reExportSource?: string;
}
```

---

## Configuration

### `.saguaro/config.yaml`

```yaml
# Model Configuration
model:
  provider: anthropic          # anthropic | openai | google
  name: claude-opus-4-6

# Output Configuration
output:
  cursor_deeplink: true

# Index Settings
index:
  enabled: true                # Enable/disable codebase indexing
  blast_radius_depth: 1        # BFS depth for importer traversal (default: 1)
  context_token_budget: 4000   # Max tokens for codebase context section

# Review Settings
review:
  max_steps: 10                # Maximum tool-calling steps per worker
  files_per_batch: 2           # Number of files per parallel worker batch

# Hook Settings
hook:
  enabled: true                # Enable auto-review when agent finishes writing

# Background Review Daemon (independent of rules engine)
daemon:
  enabled: false               # Enable daemon mode instead of direct review
  workers: 1                   # Number of parallel review workers (1-2 max)
  idle_timeout: 1800           # Seconds before daemon auto-shuts down (default 30 min)
  agent: auto                  # Detect agent or specify: claude|codex|gemini|copilot|opencode|cursor
  model: sonnet                # Optional: model name to pass to agent CLI
```

API keys are loaded from environment variables (`.env.local`, `.env`, or shell export). The config file does **not** contain API keys. The daemon does **not** require API keys — it uses the agent CLI's own subscription.

### `.saguaro/rules/`

Centralized directory at the repo root. Each rule is a self-contained `.md` file with YAML frontmatter. Loaded by `loadSaguaroRules()` in `rules/saguaro-rules.ts`.

### `.saguaro/cache/`

Auto-generated, gitignored. Contains `index.json` (persisted codebase index).

### `~/.saguaro/` (daemon state)

Global daemon state (not per-repo):

| File | Purpose |
|------|---------|
| `reviews.db` | SQLite database (WAL mode) with `review_jobs` and `reviews` tables |
| `daemon.pid` | PID, port, and start timestamp for detecting stale processes |
| `daemon.lock` | Lock file to prevent concurrent daemon spawns |

---

## Dependencies

| Category | Package | Purpose |
|----------|---------|---------|
| **AI/LLM** | `ai` (Vercel AI SDK) | `generateText()`, `tool()`, `stopWhen` |
| | `@ai-sdk/anthropic` | Anthropic provider factory |
| | `@ai-sdk/openai` | OpenAI provider factory |
| | `@ai-sdk/google` | Google provider factory |
| **Parsing** | `@swc/core` | Rust-speed TS/JS/TSX/JSX AST parsing |
| | `oxc-resolver` | Rust-speed module resolution (tsconfig-aware) |
| | `web-tree-sitter` | Multi-language parsing (Go, Java, Kotlin, Python, Rust) |
| | `tree-sitter-wasms` | Pre-built WASM binaries for tree-sitter language grammars |
| **CLI** | `yargs` | Command routing and argument parsing |
| | `chalk` | Terminal colors |
| | `boxen` | Violation output boxes |
| **TUI** | `react` | UI component model for terminal UI |
| | `@opentui/core` | Terminal renderer |
| | `@opentui/react` | React bindings for OpenTUI |
| **MCP** | `@modelcontextprotocol/sdk` | MCP server + stdio transport |
| **Core** | `minimatch` | Glob pattern matching for rule selection |
| | `js-yaml` | YAML parsing for rules and config |
| | `yaml` | YAML serialization with comment preservation |
| | `zod` | Schema validation (tool inputs, rule proposals, config) |
| | `dotenv` | Load `.env` / `.env.local` files |
| **Daemon** | `better-sqlite3` / `bun:sqlite` | SQLite database for daemon job queue and reviews |

### Why These Dependencies

The computationally expensive operations are already native:
- **AST parsing:** `@swc/core` (Rust), `web-tree-sitter` (C/WASM)
- **Module resolution:** `oxc-resolver` (Rust)
- **Git operations:** `git` binary (C)
- **File I/O:** `libuv` (C)
- **Database:** SQLite (C, via `better-sqlite3` or `bun:sqlite`)

The TypeScript orchestration layer runs in microseconds. The bottleneck is the LLM API call by orders of magnitude.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `sag init` | Initialize Saguaro: create `.saguaro/config.yaml`, `.saguaro/rules/`, install agent skills, optionally install starter rules and generate initial rules |
| `sag review` | Run review against changed files. `--base`, `--head`, `--output`, `--verbose`, `--debug` |
| `sag rules generate` | Bulk rule generation: scan codebase → zone analysis → synthesis → interactive review → write |
| `sag rules list` | List all loaded rules with globs and severity |
| `sag rules create` | LLM-powered interactive single rule creation |
| `sag rules delete` | Delete a rule by ID |
| `sag rules explain <id>` | Show full rule details |
| `sag rules validate` | Validate all rules for correct structure |
| `sag rules for <paths..>` | Show rules matching the given file/directory paths (used by agents via SKILL.md) |
| `sag rules sync` | Sync agent skill files from current `.saguaro/rules/` state |
| `sag rules locate` | Print the path to the `.saguaro/rules/` directory |
| `sag hook install` | Add agent hooks |
| `sag hook uninstall` | Remove agent hooks |
| `sag daemon start` | Start the background review daemon (also auto-started by stop hook when `daemon.enabled`) |
| `sag daemon stop` | Stop the daemon (sends SIGTERM) |
| `sag daemon status` | Check if daemon is running, show port/PID |
| `sag index` | Build/rebuild the codebase index |
| `sag model` | Switch AI provider and model interactively |
| `sag stats` | Show review history and cost analytics |
| `sag serve` | Start MCP server in stdio mode for AI agent integration |
