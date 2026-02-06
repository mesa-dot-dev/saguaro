# Session State Specification

**Version:** 1.0  
**Status:** Draft

---

## Overview

This document specifies the session state architecture for the Mesa local review agent. Session state is the working memory the agent uses during a review.

---

## Design Principles

1. **Ephemeral by default** - Session state lives only for one review run
2. **Deterministic** - Same input (diff + rules) should produce same output
3. **No hidden state** - User can always understand why a violation was flagged
4. **Optional persistence** - Future versions may add opt-in caching

---

## Memory Tiers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEMORY ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TIER 1: Working Memory (Always)                                            │
│  ────────────────────────────────                                           │
│  • In-memory only                                                           │
│  • Lives for duration of single review                                      │
│  • Discarded when mesa process exits                                        │
│                                                                              │
│  Contents:                                                                   │
│  - Diffs being reviewed                                                     │
│  - Files remaining to review                                                │
│  - Files already reviewed                                                   │
│  - Violations found so far                                                  │
│  - Agent's current thinking/context                                         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TIER 2: Review Cache (Future, Opt-in)                                      │
│  ─────────────────────────────────────                                      │
│  • File-based (.mesa/cache/)                                                │
│  • Persists across review runs                                              │
│  • Scoped to branch or commit range                                         │
│                                                                              │
│  Contents:                                                                   │
│  - Previous violations on this branch                                       │
│  - Last reviewed commit SHA                                                 │
│  - Suppressed violations (user marked as "won't fix")                       │
│                                                                              │
│  Use cases:                                                                  │
│  - Incremental reviews (only new changes)                                   │
│  - Avoid re-flagging same issue                                             │
│  - "mesa review --incremental"                                              │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TIER 3: Codebase Knowledge (Future, Experimental)                          │
│  ─────────────────────────────────────────────────                          │
│  • Learned patterns from codebase                                           │
│  • Would require explicit opt-in                                            │
│  • Significant complexity                                                   │
│                                                                              │
│  NOT planned for v1.                                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tier 1: Working Memory (v1 Scope)

### Purpose

Working memory is the scratchpad the agent uses while reviewing. It tracks:
- What files need to be reviewed
- What files have been reviewed
- What violations have been found
- The diff content for each file

### Lifecycle

```
mesa review --base main
         │
         ▼
┌─────────────────────┐
│  Create Session     │
│  - Generate ID      │
│  - Load diffs       │
│  - List files       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Agent Loop         │◄────────┐
│  - view_diff()      │         │
│  - leave_violation()│         │
│  - mark_reviewed()  │         │
└─────────┬───────────┘         │
          │                     │
          │  More files?        │
          ├────────────────────►┘
          │  No
          ▼
┌─────────────────────┐
│  Complete Review    │
│  - Output violations│
│  - Exit with code   │
└─────────┬───────────┘
          │
          ▼
    Session Discarded
    (memory freed)
```

### Data Structure

```typescript
interface WorkingMemory {
  // Session identifier (for MCP tool calls)
  sessionId: string;
  
  // Review context
  context: {
    baseBranch: string;
    baseCommit: string;
    headCommit: string;
  };
  
  // File tracking
  files: {
    // Files remaining to review
    pending: string[];
    
    // Files the agent has reviewed
    reviewed: string[];
    
    // Diff content by file path
    diffs: Record<string, string>;
  };
  
  // Violations found
  violations: Violation[];
  
  // Rules being enforced (for validation)
  activeRules: Rule[];
}

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
```

### Implementation

```typescript
// packages/mesa-core/src/review/session.ts

// In-memory store - no persistence
const sessions = new Map<string, WorkingMemory>();

export function createSession(params: {
  baseBranch: string;
  baseCommit: string;
  headCommit: string;
  changedFiles: string[];
  diffs: Record<string, string>;
  rules: Rule[];
}): WorkingMemory {
  const sessionId = crypto.randomUUID();
  
  const session: WorkingMemory = {
    sessionId,
    context: {
      baseBranch: params.baseBranch,
      baseCommit: params.baseCommit,
      headCommit: params.headCommit,
    },
    files: {
      pending: [...params.changedFiles],
      reviewed: [],
      diffs: params.diffs,
    },
    violations: [],
    activeRules: params.rules,
  };
  
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): WorkingMemory | undefined {
  return sessions.get(sessionId);
}

export function addViolation(sessionId: string, violation: Violation): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  
  // Validate rule exists
  const ruleExists = session.activeRules.some(r => r.id === violation.rule_id);
  if (!ruleExists) {
    throw new Error(`Invalid rule_id: ${violation.rule_id}`);
  }
  
  session.violations.push(violation);
}

export function markFileReviewed(sessionId: string, file: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  
  session.files.pending = session.files.pending.filter(f => f !== file);
  session.files.reviewed.push(file);
}

export function destroySession(sessionId: string): void {
  sessions.delete(sessionId);
}
```

---

## Tier 2: Review Cache (Future)

### Purpose

Optional persistence to enable:
- **Incremental reviews** - Only review changes since last run
- **Avoid repeat violations** - Don't flag the same issue twice
- **Suppression** - User can mark "won't fix" violations

### When This Would Be Useful

```bash
# First review of a branch
$ mesa review --base main
# Finds 5 violations, caches state

# Developer fixes 3, pushes more changes
$ mesa review --base main --incremental
# Only reviews new changes
# Shows 2 remaining + any new violations

# Developer marks one as "won't fix"
$ mesa suppress no-console-log src/debug.ts:42
# Won't be flagged again on this branch
```

### Proposed Data Structure

```typescript
interface ReviewCache {
  // Cache metadata
  cacheVersion: string;
  createdAt: string;
  
  // Scope (what this cache applies to)
  scope: {
    branch: string;
    baseCommit: string;
  };
  
  // Last review state
  lastReview: {
    headCommit: string;
    timestamp: string;
    violations: Violation[];
  };
  
  // User suppressions
  suppressions: Array<{
    rule_id: string;
    file: string;
    line?: number;
    reason?: string;
    suppressedAt: string;
    suppressedBy?: string;
  }>;
}
```

### Storage Location

```
.mesa/
├── config.yaml
├── rules/
│   └── *.yaml
└── cache/                    # Git-ignored
    └── reviews/
        └── feature-branch.json
```

### NOT in v1 Scope

This is documented for future reference but **not included in the v1 implementation**. 

Reasons:
1. Adds complexity to core functionality
2. Cache invalidation is hard to get right
3. Can cause confusing behavior ("why isn't it flagging this?")
4. Determinism is valuable for debugging

---

## Tier 3: Codebase Knowledge (Not Planned)

### What This Would Be

Long-term memory about the codebase:
- "This codebase uses dependency injection for time"
- "Tests in this repo use Jest, not Vitest"
- "The team prefers X pattern over Y"

### Why Not

1. **Scope creep** - Fundamentally changes what the tool is
2. **Sandcastling** - Knowledge becomes stale
3. **Opacity** - Hard to explain why agent made a decision
4. **Rules are better** - If you want the agent to know something, write a rule

### Alternative

Instead of codebase memory, encourage:
- Clear rules that encode team knowledge
- `AGENTS.md` or similar context files the agent can read
- MCP context providers for documentation

---

## FAQ

### Q: Why no persistence by default?

**A:** Determinism and debuggability. If the same diff + rules always produces the same output, it's easy to understand and debug. Hidden state makes behavior unpredictable.

### Q: Won't the agent re-flag the same issues?

**A:** Yes, but this is a feature:
- Forces resolution rather than ignoring
- Clear signal of what's wrong
- No confusion about "why isn't it showing X anymore"

If repeat flagging is truly a problem, we can add opt-in caching later.

### Q: What about incremental reviews?

**A:** v1 always does full diff review. For most PRs this is fine. Incremental can be added as an optimization in future versions.

### Q: How does this compare to current Mesa?

**A:** Current Mesa uses PostgreSQL to store:
- Review history
- Comment tracking  
- Token usage
- Session state for cloud agent

The local agent needs none of this. Each run is independent.

---

## Implementation Status

| Tier | Status | Notes |
|------|--------|-------|
| Tier 1: Working Memory | v1 | In-memory, ephemeral |
| Tier 2: Review Cache | Future | Opt-in, file-based |
| Tier 3: Codebase Knowledge | Not planned | Use rules/MCP instead |
