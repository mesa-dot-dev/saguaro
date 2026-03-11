# Saguaro Code Review: Architecture

Saguaro's code review package has two independent systems that share a CLI
entry point but never share a code path at runtime.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        sag CLI                                      │
│                                                                     │
│  sag review / sag hook run            sag daemon start/stop/status  │
│         │                                        │                  │
│         ▼                                        ▼                  │
│  ┌─────────────┐                        ┌──────────────┐            │
│  │ Rules Engine │                        │    Daemon    │            │
│  └─────────────┘                        └──────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

## System 1: Rules Engine

The rules engine is a simple, deterministic system. Users write rules as
markdown files, the engine matches them to changed files via globs, and
injects matched rules into the agent's context before edits.

```
.saguaro/rules/*.md       Static rule definitions (glob + markdown)
        │
        ▼
PreToolUse hook ──► glob match changed file against rules
        │
        ▼
  Inject matched rules as context ──► Claude sees rules before editing
```

**Properties:**
- No network calls, no database, no background processes
- Deterministic: same files + same rules = same injected context
- Routes through the adapter (`hook-runner.ts → runReview()`)
- Works offline, no API key beyond what the user's Claude session uses

**The rules engine is completely unaware of the daemon.** The gate is a
single early-return in `runHook()`:

```typescript
if (config.daemon?.enabled) {
  // daemon path — returns before rules engine code
  return 0;
}

// rules engine path — untouched
```

## System 2: Background Review Daemon

The daemon runs an independent review agent in the background. Unlike the
rules engine (which injects context), the daemon performs full code review
by shelling out to an installed agent CLI.

```
                        ┌──────────────────────────────────────────┐
                        │              Daemon Process              │
                        │           (127.0.0.1:7474)               │
                        │                                          │
 Stop hook fires        │  ┌────────┐    ┌──────────┐             │
 after agent turn       │  │ SQLite │◄───│ Worker 1 │──► claude -p│
        │               │  │        │    └──────────┘   (review)  │
        ▼               │  │ 2 tbls │                              │
 POST /review ─────────►│  │        │                              │
 (queue job,            │  └────────┘                              │
  return immediately)   │       ▲                                  │
                        │       │                                  │
                        └───────│──────────────────────────────────┘
                                │
 Next Stop hook fires           │
        │                       │
        ▼                       │
 GET /check?session=X ──────────┘
        │
        ▼
 If findings exist:
   inject as soft guidance
   ("fix if relevant, ignore if not")
```

### Data model

Two tables in `~/.saguaro/reviews.db`:

```
review_jobs                          reviews
┌──────────────────────┐             ┌─────────────────────┐
│ id
│ session_id            │             │ id                  │
│ repo_path             │             │ job_id (FK)         │
│ changed_files (JSON)  │──── 1:1 ───│ verdict (pass/fail) │
│ agent_summary         │             │ findings (JSON)     │
│ status                │             │ shown (bool)        │
│ worker_id             │             └─────────────────────┘
│ model                 │
│ claimed_at            │
│ completed_at          │
└──────────────────────┘
```

### Key mechanisms

**Diff-hash deduplication.** Each changed file is hashed (`sha256(git diff)`).
When a stop hook fires, the daemon compares hashes against previously
reviewed jobs in the same session. Files with identical hashes are skipped.
This prevents redundant reviews when the agent makes multiple turns without
changing a file.

**Atomic job claiming.** Workers claim jobs via a single
`UPDATE ... WHERE id = (SELECT ... WHERE status = 'queued' LIMIT 1) RETURNING *`
statement. SQLite's write lock guarantees no two workers claim the same job.

**Agent invocation.** The daemon spawns `claude -p` (or codex, gemini, etc.)
with `--allowedTools Read,Glob,Grep` — read-only access. The spawned process
runs in a clean environment with `CLAUDECODE*` vars stripped to avoid
inheriting the parent session's identity.

**Soft guidance.** Findings are injected as recommendations, not blocking
rules. The agent decides whether to fix or ignore them.

## Known Issues: Claude Code Concurrency

The daemon spawns `claude -p` alongside the user's active Claude Code
session. Two upstream issues affect this:

### 1. `~/.claude.json` write corruption

**Issue:** [anthropics/claude-code#28847](https://github.com/anthropics/claude-code/issues/28847)

Every Claude Code process reads/writes `~/.claude.json` on every tool call.
Concurrent writes corrupt the file. The internal `proper-lockfile` fallback
silently drops the lock and writes without atomicity.

**Impact on daemon:** The daemon's `claude -p` process and the user's
interactive session will race on this file. Corruption is auto-recovered
from backup but produces warning spam.

**Status:** Hotfix in progress from Anthropic.

**Our mitigation:** None needed beyond waiting for the fix. The corruption
is recoverable and does not affect review correctness.

### 2. No mechanism to detect other sessions

**Issue:** [anthropics/claude-code#19364](https://github.com/anthropics/claude-code/issues/19364)

There is no session lock file, no `CLAUDE_SESSION_ID` env var, and no API
to check if another Claude Code session is running. This means we cannot
implement "wait until idle" scheduling.

**Impact on daemon:** We cannot defer reviews to quiet periods. The daemon
must be designed to run safely alongside active sessions (which it is —
read-only tools, stripped env vars).

**Status:** Feature request open, unimplemented.

**Our mitigation:** Design for safe concurrency rather than serialized
access. Read-only tool restrictions prevent working tree conflicts.

## Future Considerations

These are things we may want but deliberately don't build yet:

- **Session-aware scheduling.** If Anthropic ships session lock files
  (#19364), the worker could defer reviews when the user's session is in a
  heavy edit cycle, reducing resource contention.

- **Review history UI.** The SQLite store already has the data for a
  `sag daemon history` command or a web dashboard showing review verdicts
  over time. No schema changes needed.

- **Configurable review prompt.** The staff-engineer prompt is hardcoded.
  A `.saguaro/review-prompt.md` override would let teams customize what the
  reviewer flags without touching code.

- **Multi-repo awareness.** The daemon currently reviews one repo at a time
  based on `repoPath` in the job payload. For monorepo setups with multiple
  Saguaro configs, the daemon could route jobs to different prompt/rule
  configurations.

- **Idle timeout tuning.** The daemon auto-shuts down after 30min idle.
  This is a config value (`daemon.idle_timeout`) but we haven't validated
  whether 30min is the right default for typical workflows.
