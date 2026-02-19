<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: guard-percentage-division
title: Guard against division by zero in percentages
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag division operations where the denominator could be zero. Dividing
by zero produces Infinity or NaN.


### Violations

```
// Division by zero produces Infinity or NaN when total is 0
const rate = (successCount / totalCount) * 100;

```
