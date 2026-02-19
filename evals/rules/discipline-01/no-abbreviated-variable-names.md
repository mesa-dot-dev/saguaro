<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-abbreviated-variable-names
title: No abbreviated variable or parameter names
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag variable and parameter names that are 2 characters or shorter.
Single-character names in arrow function callbacks are excluded.


### Violations

```
// 2-char variable name — use a descriptive name instead
const ev = new CustomEvent("change");

```
