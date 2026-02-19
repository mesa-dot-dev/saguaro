<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: cascade-delete-review
title: Review cascade deletes in migrations
severity: error
globs:
  - "**/scripts/**/*.ts"
  - "**/migrations/**/*.ts"
---

Flag DELETE statements in migrations on tables with cascade-delete
foreign keys. Verify the WHERE predicate won't match more rows than
intended, especially after prior migration steps change the data.


### Violations

```
// Cascade-delete may remove more rows than intended if FKs reference this table
DELETE FROM departments WHERE company_id = ?;

```
