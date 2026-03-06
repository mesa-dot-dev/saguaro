<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: daemon-store-json-serialization
title: DaemonStore must JSON-serialize complex fields before SQLite storage
severity: error
globs:
  - src/daemon/store.ts
  - src/daemon/**/*.ts
tags:
  - database
  - serialization
  - correctness
---

SQLite does not natively handle arrays or objects. The `DaemonStore` class stores structured data (changed files, findings) as JSON strings in TEXT columns. When inserting, complex fields must be serialized with `JSON.stringify()`. When reading, they must be parsed with `JSON.parse()`.

The existing pattern:
- `changedFiles` is stored as `JSON.stringify(input.changedFiles)` and parsed back with `JSON.parse(row.changed_files)`
- `findings` is stored as `JSON.stringify(input.findings)` and returned as raw string for the caller to parse

Flag:
- Inserting an array or object directly into a SQLite column without `JSON.stringify`
- Reading a JSON TEXT column and using it without `JSON.parse`

### Violations

```
this.db.prepare('INSERT INTO reviews (findings) VALUES (?)').run(input.findings);
```

```
const files = row.changed_files;  // using raw string as array
```

### Compliant

```
this.db.prepare('INSERT INTO reviews (findings) VALUES (?)').run(JSON.stringify(input.findings));
```

```
const files: ChangedFile[] = JSON.parse(row.changed_files);
```
