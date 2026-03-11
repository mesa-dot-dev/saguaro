<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: cross-file-contract-violation
title: Cross-file contract violation
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag when code violates a function or callback contract defined in
another file. Check that callback signatures match the expected type
in arity, sync/async, and return type. Cross-reference the type
definitions in the diff.


### Violations

```
// Callback is sync but the contract in types.ts requires async — return value is lost
registry.onEvent("shutdown", (ctx) => { cleanup(ctx); });
// where EventHandler = (ctx: Context) => Promise<void>

```
