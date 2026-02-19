<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-silent-migration-failures
title: No silent migration failures
severity: error
globs:
  - "**/scripts/**/*.ts"
  - "**/migrations/**/*.ts"
---

Flag try/catch blocks in migrations that swallow errors and continue.
Silent migration failures can leave the database in an inconsistent
state.


### Violations

```
// Migration error is swallowed — table may be left in inconsistent state
try { await db.execute(alterTable); } catch (e) { console.log("skipped"); }

```
