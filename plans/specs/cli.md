# CLI Specification

**Version:** 1.0  
**Status:** Draft

---

## Overview

The Mesa CLI is the primary interface for running local code reviews. It's designed to be:

- **Silent by default** - No output unless violations found
- **CI-friendly** - Exit codes and JSON output for automation
- **Simple** - Minimal required arguments

---

## Installation

```bash
# npm
npm install -g @mesa/cli

# bun
bun add -g @mesa/cli

# Or run directly
npx mesa review --base main
bunx mesa review --base main
```

---

## Commands

### `mesa review`

Run a code review against defined rules.

```bash
mesa review [options]
```

**Options:**

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--base <branch>` | `-b` | `main` | Base branch to diff against |
| `--output <format>` | `-o` | `console` | Output format: `console`, `json`, `markdown` |
| `--verbose` | `-v` | `false` | Show detailed progress |
| `--config <path>` | `-c` | `.mesa/config.yaml` | Path to config file |

**Examples:**

```bash
# Basic review against main
mesa review --base main

# Review against specific branch
mesa review --base origin/develop

# JSON output for CI
mesa review --base main --output json > review.json

# Verbose output for debugging
mesa review --base main --verbose

# Custom rules directory
mesa review --base main --rules ./custom-rules/
```

**Exit Codes:**

| Code | Meaning |
|------|---------|
| 0 | No violations found |
| 1 | Violations found (error severity) |
| 2 | Configuration error |
| 3 | Runtime error |

---

### `mesa init`

Initialize Mesa in a repository.

```bash
mesa init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing configuration |

**Creates:**

```
.mesa/
+-- config.yaml    # Default configuration
+-- rules/
    +-- .gitkeep   # Empty rules directory
```

**Example config.yaml:**

```yaml
# Mesa Configuration
# https://docs.mesa.dev/local/config

model:
  provider: anthropic
  name: claude-sonnet-4-20250514

output:
  format: console
  verbose: false

# MCP context providers (optional)
# mcp:
#   servers:
#     linear:
#       command: "npx @anthropic/mcp-server-linear"
#       env:
#         LINEAR_API_KEY: "${LINEAR_API_KEY}"
```

---

### `mesa rules`

Manage and inspect rules.

```bash
mesa rules <subcommand>
```

**Subcommands:**

#### `mesa rules list`

List all defined rules.

```bash
mesa rules list [options]
```

| Option | Description |
|--------|-------------|
| `--format <format>` | Output format: `table`, `json` |
| `--tags <tags>` | Filter by tags (comma-separated) |

**Example output:**

```
ID                      TITLE                           SEVERITY  GLOBS
no-wall-clock           Ban direct wall clock access    error     **/*.rs
service-spawn-pattern   Web services must use spawn     error     **/lib.rs
no-console-log          No console.log in production    warning   src/**/*.ts

3 rules loaded
```

#### `mesa rules explain <rule-id>`

Show detailed information about a rule.

```bash
mesa rules explain no-wall-clock
```

**Example output:**

```
Rule: no-wall-clock
Title: Ban direct wall clock access
Severity: error
Tags: rust, testing, architecture

Globs:
  - **/*.rs
  - !**/tests/**
  - !**/benches/**

Instructions:
  Utc::now() or any analogous "get wall clock time" function should be 
  banned from Rust services. Use a Clock trait instead...

Examples:
  Violations:
    - Utc::now()
    - SystemTime::now()
  Compliant:
    - clock.now()
    - self.clock.utc_now()
```

#### `mesa rules validate`

Validate rule files without running a review.

```bash
mesa rules validate [--rules <path>]
```

**Example output:**

```
Validating rules in .mesa/rules/...

  [OK] no-wall-clock.yaml
  [OK] service-spawn-pattern.yaml
  [ERR] broken-rule.yaml
       - Missing required field: severity
       - Invalid glob pattern: [invalid

1 error, 0 warnings
```

#### `mesa rules create`

Create a new rule file with an interactive flow.

```bash
mesa rules create [title]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--id <id>` | Rule id (kebab-case). Defaults to a sanitized title |
| `--severity <level>` | `error`, `warning`, or `info` (default: `error`) |
| `--globs <globs>` | Comma-separated glob patterns |
| `--instructions <text>` | Rule instructions |

**Interactive flow (defaults shown in parentheses):**

```
Title:
Severity (error, warning, info) (error):
Affected file globs (comma-separated, or language like "python", blank for all files) (**/*):
Describe the rule (one sentence is fine, blank line to finish):
```

**Language shortcuts for globs:**

```
javascript/js  -> **/*.js
typescript/ts  -> **/*.{ts,tsx}
python/py      -> **/*.py
rust/rs        -> **/*.rs
etc
```

**Notes:**

- Rule id is auto-derived from the title and only prompted for when needed.
- Common glob typo `**.rs` is normalized to `**/*.rs`.

---

### `mesa check`

Check a specific rule against a file or code snippet.

```bash
mesa check <rule-id> [file] [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--stdin` | Read code from stdin |
| `--code <string>` | Check inline code string |

**Examples:**

```bash
# Check a file against a rule
mesa check no-wall-clock src/api/handler.rs

# Check code from stdin
echo "let now = Utc::now();" | mesa check no-wall-clock --stdin

# Check inline code
mesa check no-wall-clock --code "let now = Utc::now();"
```

---

### `mesa serve`

Run Mesa as an MCP server for Claude/Cursor integration.

```bash
mesa serve [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--port <port>` | `3000` | Port to listen on |
| `--stdio` | `false` | Use stdio transport (for direct MCP) |

**Examples:**

```bash
# HTTP server
mesa serve --port 3000

# stdio for direct MCP integration
mesa serve --stdio
```

---

## Output Formats

### Console (default)

Human-readable output for terminal use.

**No violations:**
```
(no output, exit code 0)
```

**With violations:**
```
X src/api/handler.rs:47 [error]
  Rule: no-wall-clock
  
  Direct call to Utc::now() detected. Inject a Clock dependency
  instead of accessing wall clock time directly.
  
  47 | -   let now = Utc::now();
     | +   let now = self.clock.now();

X src/lib.rs [error]
  Rule: service-spawn-pattern
  
  Web service not exposed via spawn_* function.

2 violations found (2 errors, 0 warnings)
```

### JSON

Machine-readable output for CI/CD pipelines.

```json
{
  "violations": [
    {
      "rule_id": "no-wall-clock",
      "rule_title": "Ban direct wall clock access",
      "severity": "error",
      "file": "src/api/handler.rs",
      "line": 47,
      "column": 15,
      "message": "Direct call to Utc::now() detected...",
      "suggestion": "let now = self.clock.now();"
    }
  ],
  "summary": {
    "files_reviewed": 2,
    "rules_checked": 2,
    "errors": 1,
    "warnings": 0,
    "infos": 0
  }
}
```

### Markdown

Human-readable report for sharing or archiving.

```markdown
# Mesa Review Report

**Date:** 2025-02-03T10:30:00Z  
**Base:** main  
**Head:** feature/new-api

## Summary

- Files reviewed: 2
- Rules checked: 2
- Errors: 1
- Warnings: 0

## Violations

### src/api/handler.rs:47

**Rule:** no-wall-clock (error)

Direct call to Utc::now() detected. Inject a Clock dependency
instead of accessing wall clock time directly.

```diff
- let now = Utc::now();
+ let now = self.clock.now();
```
```

---

## Configuration File

### Location

Configuration is loaded from (in order):

1. `--config` flag
2. `.mesa/config.yaml`
3. `~/.config/mesa/config.yaml` (global)

### Schema

```yaml
# .mesa/config.yaml

# Model configuration
model:
  provider: anthropic  # anthropic | openai | google
  name: claude-sonnet-4-20250514

# Output defaults
output:
  format: console  # console | json | markdown
  verbose: false

# MCP context providers
mcp:
  servers:
    linear:
      command: "npx @anthropic/mcp-server-linear"
      env:
        LINEAR_API_KEY: "${LINEAR_API_KEY}"
    
    notion:
      command: "npx @anthropic/mcp-server-notion"
      env:
        NOTION_API_KEY: "${NOTION_API_KEY}"

# Review settings
review:
  # Maximum files to review in one run
  max_files: 50
  
  # Timeout per file (seconds)
  timeout_per_file: 60
```

---

## Environment Variables

### Required

One of these is required depending on your model provider:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

### Optional

```bash
# For MCP context providers
LINEAR_API_KEY=lin_api_...
NOTION_API_KEY=secret_...

# Override config file location
MESA_CONFIG=/path/to/config.yaml

# Override rules directory
MESA_RULES=/path/to/rules/

# Debug mode
MESA_DEBUG=1
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Mesa Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for diff
      
      - name: Run Mesa Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx mesa review \
            --base origin/${{ github.base_ref }} \
            --output json > review.json
      
      - name: Upload Review
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mesa-review
          path: review.json
```

### GitLab CI

```yaml
mesa-review:
  image: node:20
  script:
    - npx mesa review --base origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME --output json > review.json
  artifacts:
    paths:
      - review.json
    when: always
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-push

npx mesa review --base origin/main

# Exit code propagates - push blocked if violations
```

---

## Programmatic API

For integration in Node.js/Bun applications:

```typescript
import { review } from '@mesa/core';

const result = await review({
  baseBranch: 'main',
  rulesPath: '.mesa/rules',
  // Optional
  model: {
    provider: 'anthropic',
    name: 'claude-sonnet-4-20250514',
  },
});

if (result.violations.length > 0) {
  console.log('Violations found:', result.violations);
  process.exit(1);
}
```
