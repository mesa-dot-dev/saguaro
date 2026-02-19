<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: cross-file-type-mismatch
title: Cross-file type mismatch
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag when code accesses properties, uses literal values, or calls
methods that don't match the type definition in another file.
Cross-reference the actual type definitions in the diff to verify.


### Violations

```
// Accessing a field that doesn't exist on the type defined in another file
const name = session.userName;
// where Session (from types.ts) has 'user: { name: string }', not 'userName'

```
