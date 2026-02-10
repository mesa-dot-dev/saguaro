# Mesa Code Review CLI

## Architecture Design Document

**Version:** 2.0
**Date:** February 2025
**Status:** Current

---

## Table of Contents

1. [Vision & Philosophy](#vision--philosophy)
2. [Core Principles](#core-principles)
3. [System Architecture](#system-architecture)
4. [Data Flow](#data-flow)
5. [Package Structure](#package-structure)
6. [Rule System](#rule-system)
7. [Agent Design](#agent-design)
8. [Codebase Indexing](#codebase-indexing)
9. [Output Model](#output-model)
10. [Key Interfaces](#key-interfaces)

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
- **No defaults** - Zero built-in rules; you define everything
- **Rules in code** - `.mesa/rules/` directory, version-controlled with git
- **Codebase-aware** - Import graph, blast radius, and symbol-level context
- **Local-first** - CLI tool with user-provided API keys
- **Multi-provider** - Anthropic, OpenAI, Google via Vercel AI SDK

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Silence by default** | No output unless rule violation found |
| **No default checks** | Zero built-in rules; user defines everything |
| **Rules in code** | `.mesa/rules/` directory in repo, versioned via git |
| **Local-first** | CLI tool; user provides own API keys |
| **Codebase-aware** | Import graph analysis + blast radius for surgical context |
| **Parallel execution** | Workers split files for concurrent LLM calls |
| **Graceful degradation** | Indexing failures never block reviews |

---

## System Architecture

```
+-----------------------------------------------------------------------------------+
|                           MESA CODE REVIEW CLI                                    |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  +---------------------------------------------------------------------------+    |
|  |                         CLI (yargs)                                       |    |
|  |   $ mesa review --base main                                              |    |
|  |   $ mesa init | rules | index                                            |    |
|  +-----+---------------------------------------------------------------------+    |
|        |                                                                          |
|        v                                                                          |
|  +---------------------------------------------------------------------------+    |
|  |                      CONTEXT LAYER                                        |    |
|  |                                                                           |    |
|  |   +---------------+   +---------------+   +-----------------------+       |    |
|  |   | Git Context   |   | Rule Loader   |   | Codebase Index        |       |    |
|  |   |               |   |               |   |                       |       |    |
|  |   | - git diff    |   | .mesa/rules/  |   | - SWC parser          |       |    |
|  |   | - changed     |   | - YAML files  |   | - oxc-resolver        |       |    |
|  |   |   files       |   | - Glob match  |   | - Import graph        |       |    |
|  |   | - repo root   |   | - Severity    |   | - Blast radius (BFS)  |       |    |
|  |   +-------+-------+   +-------+-------+   | - Symbol filtering    |       |    |
|  |           |                    |            +-----------+-----------+       |    |
|  |           +--------------------+------------------------+                  |    |
|  +---------------------------------+-------------------------------------+    |    |
|                                    |                                          |    |
|                                    v                                          |    |
|  +---------------------------------------------------------------------------+    |
|  |                      AGENT CORE (Vercel AI SDK)                           |    |
|  |                                                                           |    |
|  |   Split files into workers (3 per worker)                                 |    |
|  |                                                                           |    |
|  |   +-------------------+  +-------------------+  +-------------------+     |    |
|  |   | Worker 1          |  | Worker 2          |  | Worker N          |     |    |
|  |   | generateText()    |  | generateText()    |  | generateText()    |     |    |
|  |   |                   |  |                   |  |                   |     |    |
|  |   | Tool: read_file   |  | Tool: read_file   |  | Tool: read_file   |     |    |
|  |   | Max: 10 steps     |  | Max: 10 steps     |  | Max: 10 steps     |     |    |
|  |   +-------------------+  +-------------------+  +-------------------+     |    |
|  |            |                      |                      |                |    |
|  |            +---------- Promise.all() --------------------+                |    |
|  +---------------------------------+-------------------------------------+    |    |
|                                    |                                          |    |
|                                    v                                          |    |
|  +---------------------------------------------------------------------------+    |
|  |                      OUTPUT                                               |    |
|  |                                                                           |    |
|  |   +-- Regex parse violations from agent text output --+                   |    |
|  |   |   Format: [rule-id] file:line - description       |                   |    |
|  |   +---------------------------------------------------+                   |    |
|  |                                                                           |    |
|  |   +-----------+    +-----------+    +-------------------+                 |    |
|  |   |  Console  |    |   JSON    |    | Cursor Deeplink   |                 |    |
|  |   |  (boxen)  |    | (stdout)  |    | (clickable link)  |                 |    |
|  |   +-----------+    +-----------+    +-------------------+                 |    |
|  +---------------------------------------------------------------------------+    |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Data Flow

```
$ mesa review --base main
        |
        v
+---------------------------------------------------------------+
|  1. CONTEXT GATHERING (parallel)                              |
|                                                               |
|     getChangedFiles()          loadAllRules()                 |
|     git diff --name-only      .mesa/rules/*.yaml              |
|     --diff-filter=ACMR                                        |
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
|     buildIndex()       — SWC parse + oxc-resolver             |
|     getBlastRadius()   — BFS from changed files               |
|     buildContext()     — Symbol-level filtering, token budget  |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  5. PARALLEL AGENT EXECUTION                                  |
|                                                               |
|     Split files into groups of 3                              |
|     For each group (Promise.all):                             |
|       buildPrompt(codebaseContext + diffs + rules)            |
|       generateText({ model, system, prompt, tools })          |
|       Tool: read_file (cross-file investigation)              |
|       stopWhen: stepCountIs(10)                               |
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

## Package Structure

Single package: `@mesa/code-review`

```
packages/code-review/
+-- src/
|   +-- cli/
|   |   +-- bin/
|   |   |   +-- index.ts            # yargs command router
|   |   +-- lib/
|   |   |   +-- git.ts              # git diff, changed files, repo root
|   |   |   +-- selector.ts         # Rule loading + glob matching
|   |   +-- review.ts               # Review command orchestrator
|   |   +-- init.ts                  # mesa init
|   |   +-- rules.ts                # mesa rules (list, create, etc.)
|   |   +-- index-cmd.ts            # mesa index
|   |
|   +-- agent/
|   |   +-- runner.ts               # Vercel AI SDK generateText + workers
|   |   +-- config.ts               # .mesa/config.yaml loading, model resolution
|   |   +-- prompt.ts               # Prompt building (context + diffs + rules)
|   |   +-- parse.ts                # Regex-based violation parsing
|   |   +-- output.ts               # Console/JSON formatting, Cursor deeplinks
|   |   +-- spinner.ts              # TTY-aware progress spinner
|   |   +-- index.ts                # Public exports
|   |
|   +-- indexer/
|   |   +-- build.ts                # File discovery + incremental index building
|   |   +-- store.ts                # JSON persistence + blast radius BFS
|   |   +-- index.ts                # Context builder (symbol filtering, token budget)
|   |   +-- resolver.ts             # oxc-resolver wrapper for module resolution
|   |   +-- types.ts                # CodebaseIndex, FileEntry, ImportRef, ExportRef
|   |   +-- parsers/
|   |       +-- index.ts            # Parser dispatch + file support check
|   |       +-- swc-parser.ts       # SWC-based TS/JS/TSX/JSX parser
|   |
|   +-- types/
|       +-- types.ts                # Rule, Violation, ReviewResult, Severity
|
+-- plans/
|   +-- ARCHITECTURE.md             # This document
|
+-- package.json                    # bin: { "mesa": "./dist/cli/bin/index.js" }
```

---

## Rule System

### Philosophy

Rules are the **only thing that matters**. Everything else is infrastructure to support rule enforcement.

- Rules live in code: `.mesa/rules/*.yaml`
- Version controlled with git
- No database, no cloud dashboard
- Deterministic glob-based selection (no AI for rule matching)

### Rule Schema

```yaml
# .mesa/rules/no-wall-clock.yaml
id: no-wall-clock
title: "Ban direct wall clock access"
severity: error  # error | warning | info

globs:
  - "**/*.rs"
  - "!**/tests/**"    # Exclude tests

instructions: |
  Utc::now() should be banned. Use a Clock trait instead.

  GOOD:
    fn process(clock: &dyn Clock) {
        let now = clock.now();
    }

  BAD:
    fn process() {
        let now = Utc::now();
    }

examples:
  violations:
    - "Utc::now()"
  compliant:
    - "clock.now()"
```

### Rule Selection

Deterministic glob matching via `minimatch`, not AI:

```
Changed Files: [src/api/handler.rs, src/lib.rs]
                        |
                        v
    rust-time.yaml      -> matches **/*.rs         SELECTED
    security.yaml       -> matches **/*.{ts,rs}    SELECTED
    python-imports.yaml  -> matches **/*.py         SKIPPED
```

Negation patterns (`!**/tests/**`) are supported for excluding files.

---

## Agent Design

### Execution Model

Each review spawns parallel workers via the Vercel AI SDK `generateText()`:

1. Files are split into groups of 3 (configurable via `review.files_per_worker`)
2. Each worker gets a separate `generateText()` call with its own prompt
3. Workers run in parallel via `Promise.all()`
4. Each worker has a single tool: `read_file` for cross-file investigation
5. Workers are capped at 10 LLM steps (`stopWhen: stepCountIs(10)`)

### System Prompt

The system prompt guides the agent through three phases:

```
## Your Workflow

### Phase 1: Orient
Read the Codebase Map (if provided) to understand what files are involved
and how they connect to each other.

### Phase 2: Review
For each file and its applicable rules:
- Read the diff carefully, focusing on "+" lines (added code)
- Apply each rule's instructions to the changes
- Use read_file if you need to see surrounding context

### Phase 3: Investigate
If a potential violation needs context from other files:
- Use read_file to check related code
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

The regex parser (`parse.ts`) extracts `rule_id`, `file`, `line`, and `message`. This approach was deliberately chosen over structured output (`generateObject` or a `report_violation` tool) because:

- Text format is constrained enough that LLMs follow it reliably
- A tool-based approach would add an extra round-trip per violation
- Text output is human-readable in verbose mode
- The regex parser is small (~70 lines) and handles edge cases

### Pre-computed Context

All context is injected into the prompt upfront — the agent does not fetch diffs or rules at runtime:

- **Diffs:** Pre-computed via `git diff`, injected per-file (truncated at 30KB)
- **Rules:** Full rule definitions with instructions and examples
- **Codebase context:** Import graph analysis with symbol-level filtering (see below)

---

## Codebase Indexing

### Overview

The indexer builds an import graph of the codebase, computes a "blast radius" from changed files, and generates a token-budgeted context section for the review prompt. This gives the agent structural awareness without dumping the entire codebase.

### Pipeline

```
File Discovery (skip: node_modules, dist, .git, .mesa, etc.)
        |
        v
SWC Parse (imports, exports, signatures)
        |
        v
oxc-resolver (resolve import specifiers to repo-relative paths)
        |
        v
Reverse Index (importedBy edges)
        |
        v
JSON Persistence (.mesa/cache/index.json)
        |
        v
Blast Radius BFS (from changed files, configurable depth)
        |
        v
Symbol-Level Context (used vs other exports, token budget)
```

### Incremental Updates

Files are hashed (SHA-256). On subsequent runs, only changed files are re-parsed. The index is stored at `.mesa/cache/index.json` (gitignored).

### Blast Radius

Starting from changed files, BFS traverses:
- **Importers** — files that import from a changed file
- **Dependencies** — files that a changed file imports from

Each file in the radius is classified:
- `changed` — directly modified in the diff
- `importer` — imports symbols from a changed file
- `dependency` — exports symbols consumed by a changed file

### Symbol-Level Filtering

For files in the blast radius, the context builder cross-references imports and exports to show only relevant information:

```markdown
### src/agent/config.ts (imported by src/agent/runner.ts)
Used symbols: loadMesaConfig(): MesaConfig, resolveModel(): LanguageModel
Also exports: resolveApiKey, validateConfig
Imports from: src/types/types.ts: Rule, Severity
Imported by: src/agent/runner.ts, src/cli/review.ts
```

Key behaviors:
- **`imported-by` connections:** Cross-reference which symbols a changed file actually imports. Show full signatures for used symbols, names-only for the rest.
- **Default imports:** Matched via `isDefault` on exports (not by name, since aliases differ)
- **Namespace imports** (`import * as X`): All exports are considered used
- **Token budget:** Default 4000 tokens (~16KB). Changed files are prioritized, then importers, then dependencies. Sections that exceed the budget are skipped.

### Graceful Failure

If indexing fails for any reason, the review continues without codebase context. This is enforced by a try/catch in `getCodebaseContext()` that returns an empty string on error.

---

## Output Model

### Silence is Success

If no rules are violated, output is minimal. Violations are displayed in a styled box:

```
$ mesa review --base main

  ┌─────────────────────────────────────────────────┐
  │  Mesa Code Review Results                       │
  │                                                 │
  │  X src/api/handler.rs:47 [error]                │
  │    Rule: no-wall-clock                          │
  │    Direct call to Utc::now() detected.          │
  │                                                 │
  │  1 violation (1 error, 0 warnings)              │
  └─────────────────────────────────────────────────┘
```

### Output Formats

| Format | Flag | Use Case |
|--------|------|----------|
| Console | `--output console` (default) | Human-readable terminal output |
| JSON | `--output json` | Machine-readable for CI/CD |

### Cursor Deeplink

When `output.cursor_deeplink: true` in `.mesa/config.yaml`, the output includes a clickable terminal link that opens Cursor with a pre-filled prompt containing all violations for quick fixing.

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

// Rule definition (.mesa/rules/*.yaml)
interface Rule {
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
  };
}
```

### Codebase Index Types

```typescript
interface CodebaseIndex {
  version: 1;
  rootDir: string;
  indexedAt: string;  // ISO 8601
  files: Record<string, FileEntry>;
}

interface FileEntry {
  contentHash: string;  // SHA-256
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'go' | 'rust' | 'unknown';
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

## Dependencies

| Category | Package | Purpose |
|----------|---------|---------|
| **AI/LLM** | `ai` (Vercel AI SDK v6) | `generateText()`, `tool()`, `stopWhen` |
| | `@ai-sdk/anthropic` | Anthropic provider factory |
| | `@ai-sdk/openai` | OpenAI provider factory |
| | `@ai-sdk/google` | Google provider factory |
| **Parsing** | `@swc/core` | Rust-speed TS/JS/TSX/JSX AST parsing |
| | `oxc-resolver` | Rust-speed module resolution (tsconfig-aware) |
| **CLI** | `yargs` | Command routing and argument parsing |
| | `chalk` | Terminal colors |
| | `boxen` | Violation output boxes |
| | `figlet` | ASCII banner |
| **Core** | `minimatch` | Glob pattern matching for rule selection |
| | `js-yaml` | YAML rule/config parsing |
| | `zod` | Tool input schema validation |

### Why These Dependencies

The computationally expensive operations are already native:
- **AST parsing:** `@swc/core` (Rust)
- **Module resolution:** `oxc-resolver` (Rust)
- **Git operations:** `git` binary (C)
- **File I/O:** `libuv` (C)

The TypeScript orchestration layer runs in microseconds. The bottleneck is the LLM API call by orders of magnitude.

---

## Configuration

### `.mesa/config.yaml`

```yaml
model:
  provider: anthropic          # anthropic | openai | google
  name: claude-sonnet-4-5-20250929

api_keys:
  anthropic: ${ANTHROPIC_API_KEY}

output:
  cursor_deeplink: true

index:
  enabled: true                # default: true
  blast_radius_depth: 2        # BFS depth from changed files
  context_token_budget: 4000   # ~16KB of context
```

### `.mesa/rules/`

All YAML files in this directory are loaded as rules. No subdirectory nesting.

### `.mesa/cache/`

Auto-generated, gitignored. Contains `index.json` (persisted codebase index).

---

## Unimplemented

- `mesa check <rule-id>` — Single rule check (stub)
- `mesa serve` — MCP server mode (stub)
- Multi-language indexing — Python/Go/Rust parsers (regex-based, build when needed)
- MCP context providers — Linear, RFCs, external docs
- Programmatic API — `import { review } from '@mesa/code-review'`
