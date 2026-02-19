<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-raw-sql-interpolation
title: No string interpolation in raw SQL
severity: error
globs:
  - "**/*.ts"
---

Flag string interpolation or concatenation inside sql.raw() or
sql.unsafe(). This creates SQL injection vulnerabilities even when
other parts of the query are properly parameterized.


### Violations

```
// String interpolation in raw SQL creates injection vulnerability
const rows = await db.execute(sql.raw(`SELECT * FROM users WHERE email = '${input}'`));

```
