<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: consistent-naming-convention
title: Consistent naming convention (camelCase)
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag identifiers defined in the diff that use snake_case. This
codebase uses camelCase for functions, variables, and parameters.
UPPER_SNAKE_CASE constants are acceptable. Only flag identifiers
defined in the diff, not references to identifiers defined elsewhere.


### Violations

```
// snake_case function name — should be camelCase
function calculate_total(items: Item[]): number { ... }

```
