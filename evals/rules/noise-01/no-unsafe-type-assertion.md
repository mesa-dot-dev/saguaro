<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: no-unsafe-type-assertion
title: No unsafe type assertions
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
---

Flag type assertions (as T, as any, as unknown as T) that aren't
backed by runtime validation. A shallow structural check is not the
same as schema validation.


### Violations

```
// Shallow structural check doesn't validate field types or presence of all fields
if (typeof data === "object" && "id" in data) { return data as Account; }

```
