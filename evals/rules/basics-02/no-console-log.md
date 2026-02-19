<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-console-log
title: No console.log in production code
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
---

Flag console.log in production code.


### Violations

```
// Console output in production code clutters devtools and may leak data
console.log("User logged in:", userId);

```
