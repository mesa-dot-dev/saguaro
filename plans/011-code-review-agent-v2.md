# Plan: Mesa Code Review Agent v2 (Local-First)

## Goal
Design a local-first code review agent package under `packages/` that enforces repo-defined rules and only emits feedback when something is wrong. The system must:
- Run locally as a CLI and via MCP.
- Support diff-only bug finding and repo-context bug finding.
- Bucket similar bugs, filter unwanted categories, and dedupe against previous runs.
- Store rules in git (rules-as-code) with governance and auditability.
- Keep webhook and platform integrations behind an interface layer (future adapters).

## Constraints (From Requirements)
- **Rules are code**: stored in repo; changes are governed by git.
- **Local-first**: no external SaaS dependencies.
- **Agent has repo access**: not just diff; can fetch file context.
- **Trust agent tool calling**: bias toward trusting the abiliyt of frontier models to use tool calling to gather repo context.
- **MCP support** for local reviews.

## Repo Standards to Align With
- Core uses functional folders (not explicit layer directories): `routes/`, `lib/`, `types/`, `drizzle/`, `auth/`.
- Bun-first tooling; CLI patterns exist in `packages/bench`.
- Diff and content APIs in core are already structured: `getDiff` returns per-file diff sections and filtered files (`packages/core/src/lib/git.ts`).
- No existing review agent package; keep new package standalone.

## External Design Signals
- Cursor Bugbot: multi-pass diff, bucketization, category filtering, validator, dedupe across runs.
- Danger.js: rules-as-code via `Dangerfile` (JavaScript rules), local testing.
- Semgrep: YAML rules, local CLI with JSON output.
- Reviewdog: diff-based filtering, config-driven runners.
- Gitleaks: config precedence and baseline-based dedupe.

## Architecture

### Option A — Functional Folder Structure (Recommended Baseline)
**Shape** (interfaces grouped explicitly):
- `packages/review-agent/` (new)
  - `src/lib/` (engine, passes, bucketing, dedupe, repo access)
  - `src/types/` (Rule, Finding, Bucket, RunRecord types)
  - `src/cli/` (CLI entrypoint)

**Rule storage** (single source of truth):
- Rules live in the target repo, e.g., `.mesa/review-rules/`.
- Ruleset manifest includes `ruleset_id`, `version`, and `categories`.
- Enablement via repo config (e.g., `.mesa/review-agent.json`) with explicit allowlist of rule IDs and category toggles.

**Execution**:
- Two core passes: `DiffPass` and `ContextPass`.
- Both emit `Finding` objects into a shared IR.
- Post-processing steps: bucketize → filter categories → dedupe (against local run history).

**Strengths**: Lowest complexity, clear layering, meets all requirements.
**Tradeoffs**: Less flexibility if rules need richer runtime behavior (can grow later).

## Recommended Path
Start with **Option A** for MVP. It aligns with repo layering, keeps complexity low, and still supports all required primitives.

## Core Data Model (IR)
Define a stable `Finding` schema early (irreversible):
- `rule_id`, `rule_version`, `category`, `severity`
- `file_path`, `range` (start/end line/column)
- `message`, `evidence` (optional)
- `source` (diff/context)
- `fingerprint` (for dedupe)

Define `Bucket` as a stable grouping unit:
- `bucket_id`, `title`, `summary`, `finding_ids`, `category`

## Rule Format (YAML)
**Rule file**:
- `id`, `version`, `category`, `severity`, `description`
- `match` (pattern or DSL, minimal at MVP)
- `scope` (`diff` | `context` | `both`)
- `message_template`

**Enablement** (repo config):
- `enabled_rule_ids`: explicit list
- `disabled_categories`: list
- `ruleset_ref`: commit or tag

Rules are **opt-in only** by default.

## Minimal Rule Engine (MVP)
Focus on two rule types for v2 MVP:
1) **String/regex rule** over diff hunks and file content.
2) **Structural rule** using AST-grep (where language supported) only if explicitly enabled per rule.

## Dedupe Strategy
Local run storage (git-ignored, e.g. `.mesa/review-agent/runs.jsonl`) with:
- `run_id`, `repo`, `head`, `ruleset_ref`, `findings[]`.
- Fingerprint: `rule_id + file_path + normalized_range + message_template_hash + diff_hunk_hash`.

Dedupe rules:
- Suppress any finding with fingerprint seen in last N runs or last M days (configurable).

## Category Filtering
Category filtering is applied at engine level (not adapter-only) to prevent accidental output in any interface.

## Security/Governance
- Rules are stored in git; changes reviewed via normal code review.
- Engine records `ruleset_ref` and `rule_version` per finding.
- No network calls by default; all external access must be adapter-scoped.

## Runtime Ownership (No Sandboxing)
- CLI must bundle Opencode (or ship it as a dependency) and run it directly.
- Same principle: the CLI owns the runtime, not the user.

## Runtime Provider (Shared Harness)
Define a single runtime contract so CLI, MCP, and SDK all use the same harness:

**RuntimeProvider**
- `ensureRuntime(): { baseUrl: string }`
- `shutdown(): void` (optional)

**RuntimeConfig**
- `mode`: `embedded` | `external`
- `binaryPath?`
- `configPath?`
- `port?`
- `env?`

**Usage**
- CLI: build a `RuntimeProvider` from flags/config and run review.
- MCP: reuse the same provider; do not re-launch per call.
- SDK: accept `runtimeProvider` or `runtimeConfig` and use it internally.

## Implementation Plan (High-Level)
1) Create new package `packages/review-agent` with layered structure and CLI entrypoint.
2) Define rule schema + ruleset manifest; add Zod validation.
3) Implement diff/context data sources (local git + filesystem).
4) Build engine pipeline: diff pass → context pass → bucketize → filter → dedupe.
5) Add run storage and fingerprinting.
6) Add MCP adapter.
7) Add docs and examples for rule authoring and enablement.

## Validation & Non-Goals
- MVP does **not** need webhook integration.
- MVP does **not** require automated fixes.
- MVP avoids default checks; only configured rules run.

## Suggested Next Steps
- Confirm whether AST-grep is in-scope for rule matching in MVP.
