<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: best-effort-non-critical-ops
title: Non-critical operations must not break the main flow
severity: warning
globs:
  - src/adapter/**/*.ts
  - src/cli/**/*.ts
  - src/mcp/**/*.ts
tags:
  - error-handling
  - resilience
---

Operations that are auxiliary to the main flow (history recording, codebase context building, stats tracking) must be wrapped in try/catch blocks that swallow errors silently or log them. They should never cause the primary operation (review, rule creation, etc.) to fail.

The codebase already follows this pattern:
- `appendReviewEntry` is wrapped in `try { ... } catch { // Never let history recording break the review flow }`
- `resolveCodebaseContext` catches all errors and returns empty string: `catch { return ''; }`

Flag new auxiliary operations (analytics, indexing, context building) that are called without error handling when they shouldn't be able to abort the main workflow.

### Violations

```
const ctx = await resolveCodebaseContext(opts);
// no try/catch, will crash review if indexing fails
```

```
appendReviewEntry(entry);
// no try/catch, will crash if disk full
```

### Compliant

```
try { appendReviewEntry(entry); } catch { /* never break review */ }
```

```
try { return await getCodebaseContext(opts); } catch { return ''; }
```
