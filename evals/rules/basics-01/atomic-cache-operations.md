<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: atomic-cache-operations
title: Use atomic cache operations
severity: warning
globs:
  - "**/*.ts"
---

Flag non-atomic cache patterns where a read and write are separate
operations. Concurrent requests can modify the value between the two
calls, causing data loss.


### Violations

```
// Non-atomic read-then-write: another request can change the value between get and set
const count = await kv.get("page-views");
await kv.set("page-views", count + 1);

```
