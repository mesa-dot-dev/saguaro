<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: no-type-assertions-on-db-results
title: No type assertions on database results
severity: error
globs:
  - "**/*.ts"
---

Flag type assertions (as T) on database query results. Assertions
mask schema mismatches when columns are renamed or types change.
Let ORM types flow through or use runtime validation.


### Violations

```
// Type assertion on query result bypasses schema mismatch detection
const user = (await db.query("SELECT * FROM users WHERE id = ?", [id])) as UserRecord;

```
