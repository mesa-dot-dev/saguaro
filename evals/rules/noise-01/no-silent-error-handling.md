<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-silent-error-handling
title: No silent error handling
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag catch blocks that swallow errors without logging, re-throwing, or
returning an error indicator. Consider the actual consequences of
suppression, not just whether a comment explains the intent.


### Violations

```
// Catch swallows the error — caller never knows the operation failed
try { await sendEmail(to, body); } catch (e) { /* best effort */ }

```
