# Mesa Local Review Agent

## Architecture Design Document

**Version:** 1.0  
**Date:** February 2025  
**Status:** Draft for Team Review

---

## Table of Contents

1. [Vision & Philosophy](#vision--philosophy)
2. [Core Principles](#core-principles)
3. [System Architecture](#system-architecture)
4. [Rule System](#rule-system)
5. [Data Flow](#data-flow)
6. [Component Architecture](#component-architecture)
7. [Agent Design](#agent-design)
8. [Session & Memory](#session--memory)
9. [Output Model](#output-model)
10. [What We Keep vs Drop](#what-we-keep-vs-drop)

---

## Vision & Philosophy

> An AI code review tool that **only speaks when something is wrong**, enforces **user-defined rules stored in code**, runs **locally as a CLI/MCP tool**, and operates as a **codebase-aware agent** with extensible context via MCP.

### The Problem with Existing Tools

Existing AI code review tools suffer from several issues:

1. **Too chatty** - They comment on everything, including making sequence diagrams for button color changes
2. **Assume what to review** - Built-in "default" checks that can't be disabled
3. **Rules as afterthought** - Custom rules are a side feature, not the core
4. **Rules not in code** - Rules stored in cloud dashboards, not version-controlled
5. **Diff-only context** - Only see the diff, missing critical codebase context
6. **Not locally runnable** - Can't run in CI or integrate with local dev tools

### Our Solution

A review tool where:

- **Silence is success** - No output unless a rule is violated
- **No defaults** - Zero built-in rules; you define everything
- **Rules in code** - `.mesa/rules/` directory, version-controlled with git
- **Full codebase access** - Agent can read any file, grep patterns, understand context
- **Local-first** - CLI tool with user-provided API keys
- **MCP-native** - Both a server (for Claude/Cursor) and client (for context injection)

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Silence by default** | No output unless rule violation found |
| **No default checks** | Zero built-in rules; user defines everything |
| **Rules in code** | `.mesa/rules/` directory in repo, versioned via git |
| **Local-first** | CLI tool; user provides own API keys |
| **Agent architecture** | Full codebase access, not just diff |
| **Extensible context** | MCP integration for RFCs, Linear, custom docs |

---

## System Architecture

```
+-----------------------------------------------------------------------------------+
|                              MESA LOCAL REVIEW AGENT                              |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                          ENTRY POINTS                                       |  |
|  |                                                                             |  |
|  |   +-----------+      +-----------+      +---------------------+             |  |
|  |   |   CLI     |      |   MCP     |      | Programmatic API    |             |  |
|  |   |           |      |   Server  |      |                     |             |  |
|  |   | $ mesa    |      |           |      | import { review }   |             |  |
|  |   |   review  |      | Tools for |      | from '@mesa/core'   |             |  |
|  |   |   --base  |      | Claude/   |      |                     |             |  |
|  |   |   main    |      | Cursor    |      | await review({...}) |             |  |
|  |   +-----+-----+      +-----+-----+      +----------+----------+             |  |
|  |         |                  |                       |                        |  |
|  +---------+------------------+-----------------------+------------------------+  |
|            |                  |                       |                           |
|            +------------------+-----------------------+                           |
|                               |                                                   |
|                               v                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                        CONTEXT LAYER                                        |  |
|  |                                                                             |  |
|  |   +---------------+    +---------------+    +-------------------+           |  |
|  |   | Git Context   |    | Rule Loader   |    | MCP Context       |           |  |
|  |   |               |    |               |    | Providers         |           |  |
|  |   | - Diff        |    | .mesa/rules/  |    |                   |           |  |
|  |   | - Changed     |    |               |    | - Linear issues   |           |  |
|  |   |   files       |    | - YAML files  |    | - RFCs/ADRs       |           |  |
|  |   | - Commit      |    | - Glob        |    | - Custom docs     |           |  |
|  |   |   messages    |    |   patterns    |    | - Web search      |           |  |
|  |   | - Branch      |    | - Severity    |    |                   |           |  |
|  |   +-------+-------+    +-------+-------+    +---------+---------+           |  |
|  |           |                    |                      |                     |  |
|  |           +--------------------+----------------------+                     |  |
|  +---------------------------------+-------------------------------------------+  |
|                                    |                                              |
|                                    v                                              |
|  +-----------------------------------------------------------------------------+  |
|  |                         AGENT CORE                                          |  |
|  |                                                                             |  |
|  |   +-----------------------------------------------------------------------+ |  |
|  |   |                    REVIEW AGENT                                       | |  |
|  |   |                                                                       | |  |
|  |   |   System Prompt:                                                      | |  |
|  |   |   - "Only comment when a rule is violated"                            | |  |
|  |   |   - "Each comment MUST cite a rule ID"                                | |  |
|  |   |   - "If no violations, output nothing"                                | |  |
|  |   |                                                                       | |  |
|  |   |   Tools Available:                                                    | |  |
|  |   |   +----------+ +----------+ +------+ +------------------+             | |  |
|  |   |   |view_diff | |read_file | | grep | | leave_violation  |             | |  |
|  |   |   +----------+ +----------+ +------+ +------------------+             | |  |
|  |   |   +------+ +------+ +-------+ +--------------------+                  | |  |
|  |   |   | glob | | list | | batch | | mcp_* (external)   |                  | |  |
|  |   |   +------+ +------+ +-------+ +--------------------+                  | |  |
|  |   +-----------------------------------------------------------------------+ |  |
|  +-----------------------------------------------------------------------------+  |
|                                    |                                              |
|                                    v                                              |
|  +-----------------------------------------------------------------------------+  |
|  |                      OUTPUT LAYER                                           |  |
|  |                                                                             |  |
|  |   +-----------+    +-----------+    +-----------+                          |  |
|  |   |  Stdout   |    | JSON File |    | Markdown  |                          |  |
|  |   | (default) |    | (for CI)  |    |  Report   |                          |  |
|  |   |           |    |           |    |           |                          |  |
|  |   | Silent if |    | Machine   |    | Human     |                          |  |
|  |   | no issues |    | readable  |    | readable  |                          |  |
|  |   +-----------+    +-----------+    +-----------+                          |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Rule System

### Philosophy

Rules are the **only thing that matters**. Everything else is infrastructure to support rule enforcement.

- Rules live in code: `.mesa/rules/*.yaml`
- Version controlled with git
- Access control via CODEOWNERS
- No database, no cloud dashboard
- Deterministic glob-based selection (no AI for rule matching)

### Directory Structure

```
repository/
+-- .mesa/
|   +-- config.yaml              # Global configuration
|   +-- rules/
|       +-- rust-time.yaml       # Rule: ban wall clock access
|       +-- rust-services.yaml   # Rule: service spawn pattern
|       +-- security.yaml        # Rule: security practices
|       +-- architecture.yaml    # Rule: architectural constraints
|
+-- CODEOWNERS
    # .mesa/ rules require senior review
    .mesa/ @senior-engineers @platform-team
```

### Rule Schema

See [specs/rule-schema.md](./specs/rule-schema.md) for full specification.

```yaml
# Example: .mesa/rules/rust-time.yaml

id: no-wall-clock
title: "Ban direct wall clock access"
severity: error  # error | warning | info

globs:
  - "**/*.rs"
  - "!**/tests/**"    # Exclude tests

instructions: |
  Utc::now() or any analogous "get wall clock time" function 
  should be banned from Rust services. Use a Clock trait instead.
  Always dependency inject time.
  
  GOOD:
    fn process(clock: &dyn Clock) {
        let now = clock.now();
    }
  
  BAD:
    fn process() {
        let now = Utc::now();  // Direct wall clock access!
    }

examples:
  violations:
    - "Utc::now()"
    - "SystemTime::now()"
  compliant:
    - "clock.now()"
    - "self.clock.utc_now()"
```

### Rule Selection (Deterministic)

Rules are selected based on **glob pattern matching**, not AI:

```
Changed Files: [src/api/handler.rs, src/lib.rs]
                        |
                        v
+--------------------------------------------------------+
|  Filter rules by glob patterns                         |
|                                                        |
|  rust-time.yaml      -> matches **/*.rs     SELECTED   |
|  rust-services.yaml  -> matches src/lib.rs  SELECTED   |
|  python-imports.yaml -> matches **/*.py     SKIPPED    |
+--------------------------------------------------------+
```

---

## Data Flow

```
USER INVOKES
     |
     |  $ mesa review --base main
     |
     v
+------------------------------------------------------------+
|  1. CONTEXT GATHERING                                      |
|                                                            |
|     Git Diff          Load Rules         MCP Context       |
|     (git diff         (.mesa/rules/      (Linear,         |
|      main...HEAD)      *.yaml)            RFCs, etc.)      |
+------------------------------------------------------------+
                         |
                         v
+------------------------------------------------------------+
|  2. RULE SELECTION                                         |
|                                                            |
|     Match rules to changed files via glob patterns         |
|     (deterministic, no AI)                                 |
+------------------------------------------------------------+
                         |
                         v
+------------------------------------------------------------+
|  3. AGENT EXECUTION                                        |
|                                                            |
|     For each file:                                         |
|       1. view_diff(file)                                   |
|       2. Check each applicable rule                        |
|       3. Use read_file/grep for context                    |
|       4. leave_violation() if rule violated                |
|       5. mark_file_reviewed()                              |
|                                                            |
|     When done: complete_review()                           |
+------------------------------------------------------------+
                         |
                         v
+------------------------------------------------------------+
|  4. OUTPUT                                                 |
|                                                            |
|     Violations found?                                      |
|       YES -> Print violations, exit code 1                 |
|       NO  -> Silent exit, exit code 0                      |
+------------------------------------------------------------+
```

---

## Component Architecture

### Package Structure

```
packages/
+-- mesa-core/                     # Portable core logic
|   +-- src/
|   |   +-- rules/
|   |   |   +-- loader.ts          # Load rules from .mesa/rules/
|   |   |   +-- selector.ts        # Match rules to changed files
|   |   |   +-- types.ts           # Rule schema definitions
|   |   |
|   |   +-- context/
|   |   |   +-- git.ts             # Git diff, changed files
|   |   |   +-- files.ts           # File reading, glob matching
|   |   |   +-- mcp-client.ts      # MCP client for external context
|   |   |
|   |   +-- agent/
|   |   |   +-- prompts.ts         # System/user prompts
|   |   |   +-- runner.ts          # Agent execution loop
|   |   |   +-- tools.ts           # MCP tool definitions
|   |   |
|   |   +-- review/
|   |   |   +-- session.ts         # Review session state
|   |   |   +-- violations.ts      # Violation data structures
|   |   |   +-- validator.ts       # Validate violations cite rules
|   |   |
|   |   +-- output/
|   |       +-- console.ts         # Terminal output
|   |       +-- json.ts            # JSON for CI/CD
|   |       +-- markdown.ts        # Human-readable report
|   |
|   +-- index.ts                   # Main export: review()
|
+-- mesa-cli/                      # CLI entry point
|   +-- src/
|   |   +-- commands/
|   |   |   +-- review.ts          # $ mesa review
|   |   |   +-- check.ts           # $ mesa check <rule-id>
|   |   |   +-- rules.ts           # $ mesa rules list|explain
|   |   |   +-- init.ts            # $ mesa init
|   |   |
|   |   +-- index.ts
|   |
|   +-- package.json               # bin: { "mesa": "./dist/index.js" }
|
+-- mesa-mcp-server/               # MCP server for Claude/Cursor
    +-- src/
    |   +-- server.ts              # MCP server setup
    |   +-- tools.ts               # mesa_review, mesa_check, etc.
    |
    +-- package.json
```

### Key Interfaces

```typescript
// Rule definition
interface Rule {
  id: string;
  title: string;
  severity: 'error' | 'warning' | 'info';
  globs: string[];
  instructions: string;
  examples?: {
    violations?: string[];
    compliant?: string[];
  };
}

// Violation (what the agent produces)
interface Violation {
  rule_id: string;
  rule_title: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
}

// Review session state
interface ReviewSession {
  id: string;
  state: {
    diffs: Record<string, string>;
    filesToReview: string[];
    violations: Violation[];
    filesReviewed: string[];
  };
}

// Review result
interface ReviewResult {
  violations: Violation[];
  summary: {
    files_reviewed: number;
    rules_checked: number;
    errors: number;
    warnings: number;
    infos: number;
  };
}
```

---

## Agent Design

### System Prompt Philosophy

The key difference from current Mesa: **rules-only enforcer**, not generic reviewer.

```
You are a code review enforcement agent. Your ONLY job is to check
if the code changes violate any of the defined rules.

## Critical Instructions

1. **ONLY comment when a rule is violated.**
   - If no rules are violated, call `complete_review` with zero violations.
   - Do NOT make suggestions, observations, or compliments.
   - Do NOT invent rules. Only enforce the rules given.

2. **Every violation MUST cite a rule ID.**
   - Use the `leave_violation` tool with the exact rule_id.
   - If you cannot cite a rule, do not leave the comment.

3. **You have full codebase access.**
   - Use `read_file`, `grep`, `glob` to understand context.
   - Check if apparent violations are actually handled elsewhere.

4. **Be certain before flagging.**
   - False positives waste developer time.
   - When uncertain, investigate more or skip.

## Available Tools

- view_diff(file): View the diff for a changed file
- read_file(path): Read any file in the repository
- grep(pattern, include): Search for patterns
- glob(pattern): Find files matching pattern
- leave_violation(rule_id, file, line, message, suggestion?): Report
- mark_file_reviewed(file): Mark a file as fully reviewed
- complete_review(): Signal review is complete

## Rules to Enforce

{INJECTED_RULES}
```

### Tool Definitions

| Tool | Purpose | Parameters |
|------|---------|------------|
| `view_diff` | View diff for a file | `file: string` |
| `read_file` | Read any file | `path: string` |
| `grep` | Search patterns | `pattern: string, include?: string` |
| `glob` | Find files | `pattern: string` |
| `leave_violation` | Report rule violation | `rule_id, file, line?, message, suggestion?` |
| `mark_file_reviewed` | Mark file done | `file: string` |
| `complete_review` | Finish review | none |

---

## Session & Memory

### Philosophy

The agent uses **ephemeral, short-term memory only**. Each review run is independent and deterministic. There is no persistent state between runs.

This is intentional:
- **Determinism** - Same input always produces same output
- **Debuggability** - Easy to understand why a violation was flagged
- **No hidden state** - Behavior is predictable

### Working Memory (v1)

During a review, the agent tracks:

```typescript
interface WorkingMemory {
  sessionId: string;
  
  files: {
    pending: string[];           // Files remaining to review
    reviewed: string[];          // Files already processed
    diffs: Record<string, string>;
  };
  
  violations: Violation[];       // Violations found so far
  activeRules: Rule[];           // Rules being enforced
}
```

This state:
- Lives only in RAM
- Exists only during the review run
- Is discarded when the process exits

### No Persistent Memory (Intentional)

We explicitly **do not** persist:
- Previous review results
- "Learned" codebase patterns
- Suppressed violations

If you want the agent to remember something, **write a rule**.

### Future: Optional Review Cache

A future version may add opt-in caching for:
- Incremental reviews (only new changes)
- Avoiding repeat violations

This would be:
- Opt-in via `--incremental` flag
- File-based (`.mesa/cache/`)
- Git-ignored by default

See [specs/session-state.md](./specs/session-state.md) for full specification.

---

## Output Model

### Philosophy: Silence is Success

If no rules are violated, there is **no output**. Silence means success.

### Scenarios

**No Violations:**
```bash
$ mesa review --base main
$ echo $?
0

# some sort of output
```

**Violations Found:**
```
$ mesa review --base main

X src/api/handler.rs:47 [error]
  Rule: no-wall-clock
  
  Direct call to Utc::now() detected. Inject a Clock dependency
  instead of accessing wall clock time directly.
  
  47 | -   let now = Utc::now();
     | +   let now = self.clock.now();

X src/lib.rs [error]
  Rule: service-spawn-pattern
  
  Web service not exposed via spawn_* function in lib.rs.

2 violations found (2 errors, 0 warnings)

$ echo $?
1
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No violations (any severity) |
| 1 | Violations found (error severity) |
| 2 | Configuration error |
| 3 | Agent/runtime error |

---

