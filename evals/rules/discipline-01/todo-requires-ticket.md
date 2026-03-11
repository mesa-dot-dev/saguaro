<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: todo-requires-ticket
title: TODO/FIXME comments must reference a ticket
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag TODO and FIXME comments without a ticket reference (e.g.,
MESA-123). An empty ticket pattern (MESA-) without a number is not
valid. JSDoc @todo tags are not bare TODOs.


### Violations

```
// TODO without a ticket reference
// TODO: add retry logic here

```
