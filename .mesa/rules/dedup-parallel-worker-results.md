<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: dedup-parallel-worker-results
title: Results from parallel workers must be deduplicated before aggregation
severity: warning
globs:
  - src/ai/**/*.ts
  - src/adapter/**/*.ts
  - src/daemon/**/*.ts
  - "!src/**/*.test.ts"
tags:
  - correctness
  - parallel
  - dedup
---

When the review engine splits files across multiple parallel LLM workers, the same violation can appear in multiple worker results — especially for cross-file rules where both workers see the same imported file. Results must be deduplicated before returning to the caller.

The established pattern uses a composite key for dedup: `${violation.ruleId}::${violation.file}::${violation.line}`. This was introduced after duplicate violations appeared in production output.

Similarly, when the daemon dedup-checks whether to queue a new review job, it must check ALL terminal states (`done` and `failed`), not just in-progress states (`queued`, `running`). A `done` job with the same diff hash should not be re-queued, but a `failed` job should allow retry.

### Violations

```
const allViolations = workerResults.flatMap(r => r.violations);
return { violations: allViolations };
// duplicates from overlapping worker batches not removed
```

### Compliant

```
const allViolations = workerResults.flatMap(r => r.violations);
return { violations: deduplicateViolations(allViolations) };
```
