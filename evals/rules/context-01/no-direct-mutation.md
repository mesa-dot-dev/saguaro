<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: no-direct-mutation
title: No mutation of data not owned by the current scope
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag functions that mutate arrays or objects they received as
parameters instead of creating copies. Callers don't expect their
data to be modified.


### Violations

```
// Sorting the parameter array mutates the caller's data
function getTopScores(scores: number[]) { return scores.sort((a, b) => b - a).slice(0, 5); }

```
