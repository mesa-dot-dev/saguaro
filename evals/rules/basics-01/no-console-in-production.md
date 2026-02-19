<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-console-in-production
title: No console.log in production code
severity: warning
globs:
  - "**/*.ts"
  - "!**/*.test.ts"
---

Flag console.log, console.warn, and console.debug in production code.
Console output can leak sensitive data and should use structured logging.


### Violations

```
// Console output may contain sensitive values in production
console.log("Processing order", orderId, customerEmail);

```
