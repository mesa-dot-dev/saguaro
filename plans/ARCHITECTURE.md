# Mesa Code Review CLI

## Architecture Design Document

**Version:** 3.0
**Date:** February 2026
**Status:** Current

---

## Table of Contents

1. [Vision & Philosophy](#vision--philosophy)
2. [Core Principles](#core-principles)
3. [System Architecture](#system-architecture)
4. [Package Structure](#package-structure)
5. [Adapter Layer](#adapter-layer)
6. [Skills System](#skills-system)
7. [Rule Creation Pipeline](#rule-creation-pipeline)
8. [Data Flow](#data-flow)
9. [Agent Design](#agent-design)
10. [Codebase Indexing](#codebase-indexing)
11. [Output Model](#output-model)
12. [Key Interfaces](#key-interfaces)
13. [Configuration](#configuration)
14. [Dependencies](#dependencies)

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
- **Rules in code** - `.claude/skills/` directories, version-controlled with git
- **Codebase-aware** - Import graph, blast radius, and symbol-level context
- **Local-first** - CLI tool with user-provided API keys
- **Multi-provider** - Anthropic, OpenAI, Google via Vercel AI SDK

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Silence by default** | No output unless rule violation found |
| **No default checks** | Zero built-in rules; user defines everything |
| **Rules in code** | `.claude/skills/` directories in repo, versioned via git |
| **Local-first** | CLI tool; user provides own API keys |
| **Codebase-aware** | Import graph analysis + blast radius for surgical context |
| **Parallel execution** | Workers split files for concurrent LLM calls |
| **Graceful degradation** | Indexing failures never block reviews |
| **Layered architecture** | CLI → adapter → core/lib separation of concerns |

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
|  |   $ mesa init | rules list | rules create | rules delete | index         |    |
|  +-----+---------------------------------------------------------------------+    |
|        |                                                                          |
|        v                                                                          |
|  +---------------------------------------------------------------------------+    |
|  |                      ADAPTER LAYER                                        |    |
|  |                                                                           |    |
|  |   +--------------------+   +--------------------+                         |    |
|  |   | review adapter     |   | skills adapter     |                         |    |
|  |   | - runReview()      |   | - createSkill()    |                         |    |
|  |   | - wires runtime    |   | - listSkills()     |                         |    |
|  |   |   to core          |   | - deleteSkill()    |                         |    |
|  |   |                    |   | - validateSkills() |                         |    |
|  |   +--------+-----------+   +--------+-----------+                         |    |
|  +------------|-------------------------|---------+--------------------------+    |
|               |                         |                                         |
|               v                         v                                         |
|  +---------------------------------------------------------------------------+    |
|  |                      CORE + LIB                                           |    |
|  |                                                                           |    |
|  |   +---------------+   +---------------+   +-----------------------+       |    |
|  |   | review core   |   | skills (lib)  |   | Codebase Index        |       |    |
|  |   | - pure engine |   | - CRUD on     |   | - SWC parser          |       |    |
|  |   | - injected    |   |   .claude/    |   | - oxc-resolver        |       |    |
|  |   |   deps only   |   |   skills/     |   | - tree-sitter (multi) |       |    |
|  |   +-------+-------+   +-------+-------+   | - Import graph        |       |    |
|  |           |                    |            | - Blast radius (BFS)  |       |    |
|  |           +----+               |            +-----------+-----------+       |    |
|  |                |               |                        |                  |    |
|  |   +------------+---+-----------+------------------------+                  |    |
|  |   | Rule Creation Pipeline                                                |    |
|  |   |  target-resolver → target-analysis → rule-generator                   |    |
|  |   |  → rule-preview → scope-discovery → skills adapter                    |    |
|  |   +-----------------------------------------------------------------------+    |
|  |                                                                           |    |
|  +---------------------------------------------------------------------------+    |
|                                    |                                              |
|                                    v                                              |
|  +---------------------------------------------------------------------------+    |
|  |                      AGENT (Vercel AI SDK)                                |    |
|  |                                                                           |    |
|  |   Split files into workers (configurable per worker)                      |    |
|  |                                                                           |    |
|  |   +-------------------+  +-------------------+  +-------------------+     |    |
|  |   | Worker 1          |  | Worker 2          |  | Worker N          |     |    |
|  |   | generateText()    |  | generateText()    |  | generateText()    |     |    |
|  |   | Tool: read_file   |  | Tool: read_file   |  | Tool: read_file   |     |    |
|  |   +-------------------+  +-------------------+  +-------------------+     |    |
|  |            |                      |                      |                |    |
|  |            +---------- Promise.all() --------------------+                |    |
|  +---------------------------------------------------------------------------+    |
|                                    |                                              |
|                                    v                                              |
|  +---------------------------------------------------------------------------+    |
|  |                      OUTPUT                                               |    |
|  |   +-- Regex parse violations from agent text output --+                   |    |
|  |   |   Format: [rule-id] file:line - description       |                   |    |
|  |   +-----------+    +-----------+    +----------------+ |                   |    |
|  |   |  Console  |    |   JSON    |    | Cursor Deeplink| |                   |    |
|  |   |  (boxen)  |    | (stdout)  |    | (clickable)    | |                   |    |
|  |   +-----------+    +-----------+    +----------------+ |                   |    |
|  +---------------------------------------------------------------------------+    |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Package Structure

Single package: `@mesa/code-review`

```
packages/code-review/
├── src/
│   ├── adapter/                    # Boundary between CLI and core/lib
│   │   ├── review.ts              # Review adapter: wires runtime to core engine
│   │   ├── review.test.ts
│   │   ├── skills.ts              # Skills adapter: createSkill, listSkills, deleteSkill, validate
│   │   └── skills.test.ts
│   │
│   ├── cli/                        # CLI layer (yargs commands + prompts)
│   │   ├── bin/
│   │   │   └── index.ts           # Yargs command router
│   │   ├── lib/
│   │   │   ├── check.ts           # mesa check (stub)
│   │   │   ├── index-cmd.ts       # mesa index
│   │   │   ├── init.ts            # mesa init
│   │   │   ├── prompt.ts          # Readline helpers: ask(), askChoice(), createReadline()
│   │   │   ├── rules.ts           # mesa rules (list, create, delete, explain, validate)
│   │   │   ├── serve.ts           # mesa serve (stub)
│   │   │   └── spinner.ts         # TTY-aware progress spinner
│   │   └── review.ts              # mesa review command orchestrator
│   │
│   ├── core/                       # Pure business logic, injected deps only
│   │   └── review.ts              # createReviewCore() — pure review engine
│   │
│   ├── indexer/                    # Codebase indexing + import graph
│   │   ├── build.ts               # File discovery + incremental index building
│   │   ├── index.ts               # Context builder (symbol filtering, token budget)
│   │   ├── resolver.ts            # oxc-resolver wrapper for module resolution
│   │   ├── store.ts               # JSON persistence + blast radius BFS
│   │   ├── types.ts               # CodebaseIndex, FileEntry, ImportRef, ExportRef
│   │   └── parsers/
│   │       ├── index.ts           # Parser dispatch + file support check
│   │       ├── swc-parser.ts      # SWC-based TS/JS/TSX/JSX parser
│   │       └── tree-sitter/       # Multi-language parsing
│   │           ├── init.ts        # Tree-sitter initialization
│   │           ├── parser.ts      # Generic tree-sitter parser
│   │           ├── types.ts       # Tree-sitter type definitions
│   │           └── languages/     # Language-specific extractors
│   │               ├── go.ts
│   │               ├── java.ts
│   │               ├── kotlin.ts
│   │               ├── python.ts
│   │               └── rust.ts
│   │
│   ├── lib/                        # Shared library code
│   │   ├── constants.ts           # IGNORED_DIRS, PACKAGE_MARKERS, CodebaseSnippet, toKebabCase
│   │   ├── errors.ts              # Custom error types
│   │   ├── git.ts                 # git diff, changed files, repo root
│   │   ├── logger.ts              # Debug logging
│   │   ├── review-model-config.ts # .mesa/config.yaml loading, model resolution
│   │   ├── review-runner.ts       # Vercel AI SDK generateText + workers
│   │   ├── review-runtime.ts      # Node.js runtime: file I/O, git, rule loading
│   │   ├── rule-generator.ts      # LLM-powered rule generation from target analysis
│   │   ├── rule-preview.ts        # Dry-run rules against target files
│   │   ├── scope-discovery.ts     # Discover package boundaries + existing skills dirs
│   │   ├── skills.ts              # Skills CRUD: load, parse, glob-match, create, delete
│   │   ├── target-analysis.ts     # Analyze target: file sampling, globs, placements
│   │   └── target-resolver.ts     # Smart text input: path/keyword → resolved target
│   │
│   ├── templates/                  # Built-in starter content
│   │   ├── starter-skills.ts      # Generates SKILL.md + policy YAML for starter rules
│   │   └── starter-rule-skills.ts # Starter rule policy definitions
│   │
│   ├── types/
│   │   └── types.ts               # Rule, Violation, ReviewResult, Severity, RulePolicy
│   │
│   └── index.ts                    # Public exports (programmatic API)
│
├── evals/                          # Evaluation harness for review quality
├── plans/
│   └── ARCHITECTURE.md            # This document
└── package.json                    # bin: { "mesa": "./dist/cli/bin/index.js" }
```

---

## Adapter Layer

The adapter layer (`src/adapter/`) provides a clean boundary between the CLI and the core/lib modules. CLI code should **never** import directly from `core/` or `lib/` — it goes through adapters.

### Review Adapter (`adapter/review.ts`)

Wires the Node.js runtime (file I/O, git, rule loading) to the pure review core engine:

```
CLI (rules.ts, review.ts)
    │
    └──► adapter/review.ts  — runReview(request)
              │
              ├──► lib/review-runtime.ts  — createNodeReviewRuntime()
              └──► core/review.ts         — createReviewCore(deps)
```

The core engine accepts injected deps (`ReviewInputChannel`, `Reviewer`) and contains zero I/O. The adapter wires concrete implementations.

### Skills Adapter (`adapter/skills.ts`)

Provides a unified interface for all skill operations:

- `createSkillAdapter(opts)` — Creates `SKILL.md` + `references/mesa-policy.yaml` in the target `.claude/skills/` directory
- `listSkillsAdapter(dir)` — Lists all skills from a `.claude/skills/` directory
- `deleteSkillAdapter(id, dir)` — Removes a skill directory
- `validateSkillsAdapter(dir)` — Validates skill structure and policy YAML

The adapter builds rich `SKILL.md` files with:
- YAML frontmatter (`name`, `description` with scope)
- Human-readable instructions and examples
- Reference to the machine-readable `mesa-policy.yaml`

---

## Skills System

Rules are stored as **skills** in `.claude/skills/` directories, co-located with the code they review.

### Directory Structure

```
.claude/skills/
└── <rule-id>/
    ├── SKILL.md                    # Human-readable: frontmatter + instructions + examples
    └── references/
        └── mesa-policy.yaml        # Machine-readable: globs, severity, violation patterns
```

### Skill Placement

Skills can be placed at any level in the repo hierarchy:

| Placement | Path | Scope |
|-----------|------|-------|
| **Collocated** | `src/cli/.claude/skills/` | Rules specific to that directory tree |
| **Package** | `packages/web/.claude/skills/` | Rules scoped to one package |
| **Root** | `.claude/skills/` | Global rules across the entire repo |

During review, all `.claude/skills/` directories are discovered by walking up from each changed file to the repo root. Rules are matched to files via glob patterns in `mesa-policy.yaml`.

### SKILL.md Format

```markdown
---
name: no-wall-clock
description: "Ban direct wall clock access. Enforces this rule in **/*.rs, !**/tests/**."
---

This skill enforces the Ban direct wall clock access policy.

## What this rule checks

Use a Clock trait instead of calling Utc::now() directly.

## Examples

### Violations
- `Utc::now()` — Direct wall-clock access

### Compliant
- `clock.now()` — Injected clock dependency

Machine-readable policy is defined in references/mesa-policy.yaml.
```

### mesa-policy.yaml Format

```yaml
id: no-wall-clock
title: "Ban direct wall clock access"
severity: error

globs:
  - "**/*.rs"
  - "!**/tests/**"

instructions: |
  Utc::now() should be banned. Use a Clock trait instead.

examples:
  violations:
    - pattern: "Utc::now()"
      description: "Direct wall-clock access"
    - pattern: "SystemTime::now()"
      description: "Direct system time access"
  compliant:
    - pattern: "clock.now()"
      description: "Injected clock dependency"
```

### Starter Rules

`mesa init` can optionally install a set of starter rules into `.claude/skills/`. These are defined in `src/templates/starter-rule-skills.ts` and generated via `src/templates/starter-skills.ts`. The starter rules serve as few-shot examples for the LLM during rule generation.

### Rule Loading at Review Time

1. Walk up from each changed file to repo root, collecting all `.claude/skills/` directories
2. Parse each `mesa-policy.yaml` for globs and instructions
3. Deterministic `minimatch` glob matching — no AI for rule selection
4. Negation patterns (`!**/tests/**`) supported for excluding files

---

## Rule Creation Pipeline

`mesa rules create` uses an LLM-powered pipeline to generate rules from a natural language description and target analysis.

### Flow

```
User types: "mesa rules create"
         |
         v
+--------------------------------------------------+
|  1. TARGET INPUT                                  |
|     resolveTargetInput(repoRoot)                  |
|                                                   |
|     "What code should this rule check?"           |
|     Scope picker: packages, directories, custom   |
|     → resolved target path                        |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  2. INTENT INPUT                                  |
|     "What should be different about this code?"   |
|     Free-text natural language description        |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  3. TARGET ANALYSIS                               |
|     analyzeTarget({ targetPath, repoRoot })       |
|                                                   |
|     - Sample up to 5 files from target dir        |
|     - Sample up to 3 boundary files (siblings)    |
|     - Build ASCII directory tree                  |
|     - Detect languages from extensions            |
|     - Generate suggested glob patterns            |
|     - Compute placement options                   |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  4. RULE GENERATION (LLM)                         |
|     generateRule({ description, analysis })       |
|                                                   |
|     - Select few-shot examples from starter rules |
|     - Build prompt with target files + intent     |
|     - generateText() → structured YAML policy     |
|     - Parse and validate generated policy         |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  5. RULE PREVIEW                                  |
|     previewRule(policy, targetDir)                 |
|                                                   |
|     - Walk target files matching globs            |
|     - Substring-match violation patterns           |
|     - Report: would-pass / would-flag files       |
|     - User: [A]ccept / [C]ancel                   |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  6. PLACEMENT SELECTION                           |
|     "Where should this rule be saved?"            |
|     Options from target analysis placements:      |
|     - Collocated (near target code)               |
|     - Package boundary                            |
|     - Repo root (global)                          |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|  7. SKILL CREATION                                |
|     createSkillAdapter(opts)                      |
|                                                   |
|     Writes:                                       |
|     - <skillsDir>/<id>/SKILL.md                   |
|     - <skillsDir>/<id>/references/mesa-policy.yaml|
+--------------------------------------------------+
```

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `target-resolver.ts` | Smart text input: accepts paths, keywords, or "global". Searches repo directories with ranked matching. Falls back to scope picker browse mode. |
| `target-analysis.ts` | Analyzes a target directory: samples files (up to 5, truncated to 3000 chars), samples boundary files from siblings, builds ASCII tree, detects languages, generates globs, computes placement options. |
| `rule-generator.ts` | LLM-powered generation. Builds prompt from target analysis + user intent + few-shot examples. Uses Vercel AI SDK `generateText()`. Parses structured YAML from LLM output. |
| `rule-preview.ts` | Dry-run preview. Walks target directory, applies glob patterns, substring-matches violation example patterns against file contents. Reports pass/flag counts. |
| `scope-discovery.ts` | Discovers package boundaries by walking repo tree and looking for `PACKAGE_MARKERS` (package.json, Cargo.toml, go.mod, pyproject.toml). Also finds existing `.claude/skills/` directories. |

### Preview Limitations

The preview uses **substring matching** of violation example patterns against file contents. This is a fast heuristic, not a semantic analysis. The actual LLM-powered review is more thorough and will catch violations that the preview misses. The preview exists to give the user confidence that the rule targets the right files, not to guarantee detection.

---

## Data Flow

### Review Flow

```
$ mesa review --base main
        |
        v
+---------------------------------------------------------------+
|  1. CONTEXT GATHERING (parallel)                              |
|                                                               |
|     getChangedFiles()          loadRules()                    |
|     git diff --name-only      Walk .claude/skills/ dirs       |
|     --diff-filter=ACMR        Parse mesa-policy.yaml          |
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
|     getBlastRadius()   — BFS from changed files               |
|     buildContext()     — Symbol-level filtering, token budget  |
+---------------------------------------------------------------+
                        |
                        v
+---------------------------------------------------------------+
|  5. PARALLEL AGENT EXECUTION                                  |
|                                                               |
|     Split files into groups (configurable files_per_worker)   |
|     For each group (Promise.all):                             |
|       buildPrompt(codebaseContext + diffs + rules)            |
|       generateText({ model, system, prompt, tools })          |
|       Tool: read_file (cross-file investigation)              |
|       Max steps: configurable via max_steps_size              |
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

1. Files are split into groups (configurable via `review.files_per_worker`, default 2)
2. Each worker gets a separate `generateText()` call with its own prompt
3. Workers run in parallel via `Promise.all()`
4. Each worker has a single tool: `read_file` for cross-file investigation
5. Workers are capped at configurable max steps (`review.max_steps_size`, default 50)

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

The regex parser extracts `rule_id`, `file`, `line`, and `message`. This approach was deliberately chosen over structured output because:

- Text format is constrained enough that LLMs follow it reliably
- A tool-based approach would add an extra round-trip per violation
- Text output is human-readable in verbose mode
- The regex parser is small and handles edge cases

### Pre-computed Context

All context is injected into the prompt upfront — the agent does not fetch diffs or rules at runtime:

- **Diffs:** Pre-computed via `git diff`, injected per-file (truncated at 30KB)
- **Rules:** Full rule definitions with instructions and examples
- **Codebase context:** Import graph analysis with symbol-level filtering (see below)

---

## Codebase Indexing

### Overview

The indexer builds an import graph of the codebase, computes a "blast radius" from changed files, and generates a token-budgeted context section for the review prompt. This gives the agent structural awareness without dumping the entire codebase.

### Supported Languages

| Language | Parser | Status |
|----------|--------|--------|
| TypeScript/TSX | SWC (`@swc/core`) | Full support |
| JavaScript/JSX | SWC (`@swc/core`) | Full support |
| Go | tree-sitter | Implemented |
| Java | tree-sitter | Implemented |
| Kotlin | tree-sitter | Implemented |
| Python | tree-sitter | Implemented |
| Rust | tree-sitter | Implemented |

### Pipeline

```
File Discovery (skip: node_modules, dist, .git, .mesa, etc.)
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

// Rule policy (from mesa-policy.yaml)
interface RulePolicy {
  id: string;
  title: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  examples?: {
    violations?: Array<{ pattern: string; description: string }>;
    compliant?: Array<{ pattern: string; description: string }>;
  };
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

// Review engine outcome (discriminated union)
type ReviewEngineOutcome =
  | { kind: 'no-changed-files'; ... }
  | { kind: 'no-matching-skills'; ... }
  | { kind: 'reviewed'; result: ReviewResult; ... };
```

### Target Analysis Types

```typescript
interface TargetAnalysis {
  resolvedPath: string;       // absolute path to the target
  relativePath: string;       // relative to repo root
  files: CodebaseSnippet[];   // sampled from target dir (up to 5 files, each ≤3000 chars)
  boundaryFiles: CodebaseSnippet[]; // sampled from sibling dirs (up to 3 files)
  directoryTree: string;      // ASCII tree of target's parent showing siblings
  suggestedGlobs: string[];   // e.g., ["packages/web/src/**/*.{ts,tsx}", "!**/*.test.*"]
  detectedLanguages: string[];// e.g., ["typescript"]
  placements: PlacementOption[];
}

interface PlacementOption {
  skillsDir: string;          // absolute path where .claude/skills/ would go
  label: string;              // human-readable (e.g., "src/cli (collocated with code)")
  reason: string;
  recommended: boolean;
  type: 'collocated' | 'package' | 'root' | 'existing';
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

### `.mesa/config.yaml`

```yaml
# Model Configuration
model:
  provider: anthropic          # anthropic | openai | google
  name: claude-opus-4-6

# Output Configuration
output:
  cursor_deeplink: true

# Review Settings
review:
  max_steps_size: 50           # Maximum tool-calling steps per worker
  files_per_worker: 2          # Number of files per parallel worker batch
```

API keys are loaded from environment variables (`.env.local`, `.env`, or shell export). The config file does **not** contain API keys.

### `.claude/skills/`

Skills directories at any level in the repo. Each skill has a `SKILL.md` and `references/mesa-policy.yaml`.

### `.mesa/cache/`

Auto-generated, gitignored. Contains `index.json` (persisted codebase index).

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
| | `tree-sitter` | Multi-language parsing (Go, Java, Kotlin, Python, Rust) |
| **CLI** | `yargs` | Command routing and argument parsing |
| | `chalk` | Terminal colors |
| | `boxen` | Violation output boxes |
| | `figlet` | ASCII banner |
| **Core** | `minimatch` | Glob pattern matching for rule selection |
| | `js-yaml` | YAML rule/config parsing |
| | `zod` | Tool input schema validation |

### Why These Dependencies

The computationally expensive operations are already native:
- **AST parsing:** `@swc/core` (Rust), `tree-sitter` (C)
- **Module resolution:** `oxc-resolver` (Rust)
- **Git operations:** `git` binary (C)
- **File I/O:** `libuv` (C)

The TypeScript orchestration layer runs in microseconds. The bottleneck is the LLM API call by orders of magnitude.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `mesa init` | Initialize Mesa: create `.mesa/config.yaml`, `.claude/skills/`, optionally install starter rules |
| `mesa review` | Run review against changed files. `--base`, `--head`, `--output`, `--verbose`, `--skip-preview` |
| `mesa rules list` | List all loaded rules with globs and severity |
| `mesa rules create` | LLM-powered interactive rule creation (see Rule Creation Pipeline) |
| `mesa rules delete` | Delete a rule by ID |
| `mesa rules explain <id>` | Show full rule details |
| `mesa rules validate` | Validate all rules for correct structure |
| `mesa index` | Build/rebuild the codebase index |
| `mesa check` | Single rule check (stub) |
| `mesa serve` | MCP server mode (stub) |
